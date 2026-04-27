import { CollectionService, HttpService } from "@rbxts/services";
import Utils from "../Utils";
import Recording from "../Recording";
import Hashing from "../Hashing";

const ChangeHistoryService = game.GetService("ChangeHistoryService");
const Selection = game.GetService("Selection");

function describeValue(value: unknown): unknown {
	const t = typeOf(value);
	if (t === "boolean" || t === "number" || t === "string" || t === "nil") return value;
	if (t === "Vector3") {
		const v = value as Vector3;
		return { X: v.X, Y: v.Y, Z: v.Z, _type: "Vector3" };
	}
	if (t === "Vector2") {
		const v = value as Vector2;
		return { X: v.X, Y: v.Y, _type: "Vector2" };
	}
	if (t === "Color3") {
		const c = value as Color3;
		return { R: c.R, G: c.G, B: c.B, _type: "Color3" };
	}
	if (t === "UDim") {
		const u = value as UDim;
		return { Scale: u.Scale, Offset: u.Offset, _type: "UDim" };
	}
	if (t === "UDim2") {
		const v = value as UDim2;
		return {
			X: { Scale: v.X.Scale, Offset: v.X.Offset },
			Y: { Scale: v.Y.Scale, Offset: v.Y.Offset },
			_type: "UDim2",
		};
	}
	if (t === "CFrame") {
		const cf = value as CFrame;
		const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf.GetComponents();
		return {
			Position: { X: x, Y: y, Z: z },
			Rotation: [r00, r01, r02, r10, r11, r12, r20, r21, r22],
			_type: "CFrame",
		};
	}
	if (t === "BrickColor") {
		const bc = value as BrickColor;
		return { Name: bc.Name, _type: "BrickColor" };
	}
	if (t === "EnumItem") {
		const e = value as EnumItem;
		return { Name: e.Name, EnumType: tostring(e.EnumType), Value: e.Value, _type: "EnumItem" };
	}
	if (t === "Instance") {
		const inst = value as Instance;
		return { Path: getInstancePath(inst), ClassName: inst.ClassName, _type: "Instance" };
	}
	return tostring(value);
}

function safeJsonEncode(value: unknown, depth: number): { ok: true; value: unknown } | { ok: false; reason: string } {
	if (depth > 6) return { ok: false, reason: "max depth exceeded" };
	const t = typeOf(value);
	if (t === "table") {
		const tbl = value as Record<string | number, unknown>;
		const out: Record<string | number, unknown> = {};
		const isArray = (() => {
			let n = 0;
			for (const [k] of pairs(tbl)) {
				if (typeIs(k, "number")) n++;
				else return false;
			}
			return n > 0;
		})();
		if (isArray) {
			const arr: defined[] = [];
			const arrLen = (tbl as unknown as defined[]).size();
			for (let i = 0; i < arrLen; i++) {
				const v = (tbl as unknown as defined[])[i];
				const r = safeJsonEncode(v, depth + 1);
				if (!r.ok) return r;
				arr.push(r.value as defined);
			}
			return { ok: true, value: arr };
		}
		for (const [k, v] of pairs(tbl)) {
			const r = safeJsonEncode(v, depth + 1);
			if (!r.ok) return r;
			out[tostring(k)] = r.value;
		}
		return { ok: true, value: out };
	}
	if (t === "function" || t === "thread" || t === "userdata") {
		return { ok: false, reason: `non-serializable type: ${t}` };
	}
	return { ok: true, value: describeValue(value) };
}

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

function serializeValue(value: unknown): unknown {
	const vType = typeOf(value);
	if (vType === "Vector3") {
		const v = value as Vector3;
		return { X: v.X, Y: v.Y, Z: v.Z, _type: "Vector3" };
	} else if (vType === "Color3") {
		const v = value as Color3;
		return { R: v.R, G: v.G, B: v.B, _type: "Color3" };
	} else if (vType === "CFrame") {
		const v = value as CFrame;
		return { Position: { X: v.Position.X, Y: v.Position.Y, Z: v.Position.Z }, _type: "CFrame" };
	} else if (vType === "UDim2") {
		const v = value as UDim2;
		return {
			X: { Scale: v.X.Scale, Offset: v.X.Offset },
			Y: { Scale: v.Y.Scale, Offset: v.Y.Offset },
			_type: "UDim2",
		};
	} else if (vType === "BrickColor") {
		const v = value as BrickColor;
		return { Name: v.Name, _type: "BrickColor" };
	}
	return value;
}

function deserializeValue(attributeValue: unknown, valueType?: string): unknown {
	if (!typeIs(attributeValue, "table")) return attributeValue;

	const tbl = attributeValue as Record<string, unknown>;
	const t = (tbl._type as string) ?? valueType;

	if (t === "Vector3") {
		return new Vector3((tbl.X as number) ?? 0, (tbl.Y as number) ?? 0, (tbl.Z as number) ?? 0);
	} else if (t === "Color3") {
		return new Color3((tbl.R as number) ?? 0, (tbl.G as number) ?? 0, (tbl.B as number) ?? 0);
	} else if (t === "UDim2") {
		const x = tbl.X as Record<string, number> | undefined;
		const y = tbl.Y as Record<string, number> | undefined;
		return new UDim2(x?.Scale ?? 0, x?.Offset ?? 0, y?.Scale ?? 0, y?.Offset ?? 0);
	} else if (t === "BrickColor") {
		return new BrickColor(((tbl.Name as string) ?? "Medium stone grey") as unknown as number);
	}
	return attributeValue;
}

function getAttribute(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributeName = requestData.attributeName as string;

	if (!instancePath || !attributeName) {
		return { error: "Instance path and attribute name are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };

	const [success, result] = pcall(() => {
		const value = instance.GetAttribute(attributeName);
		return {
			instancePath,
			attributeName,
			value: serializeValue(value),
			valueType: typeOf(value),
			exists: value !== undefined,
		};
	});

	if (success) return result;
	return { error: `Failed to get attribute: ${result}`, errorCode: "attribute_read_failed" };
}

function setAttribute(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributeName = requestData.attributeName as string;
	const attributeValue = requestData.attributeValue;
	const valueType = requestData.valueType as string | undefined;

	if (!instancePath || !attributeName) {
		return { error: "Instance path and attribute name are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };
	const recordingId = beginRecording(`Set attribute ${attributeName} on ${instance.Name}`);

	const [success, result] = pcall(() => {
		const value = deserializeValue(attributeValue, valueType);
		instance.SetAttribute(attributeName, value as AttributeValue);

		return {
			success: true, instancePath, attributeName,
			value: attributeValue,
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to set attribute: ${result}`, errorCode: "attribute_write_failed" };
}

function getAttributes(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const knownHash = requestData.knownHash as string | undefined;
	if (!instancePath) return { error: "Instance path is required", errorCode: "missing_arg", argName: "instancePath" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };

	const [success, result] = pcall(() => {
		const attributes = instance.GetAttributes();
		const serializedAttributes: Record<string, { value: unknown; type: string }> = {};
		let count = 0;

		for (const [name, value] of pairs(attributes)) {
			serializedAttributes[name as string] = {
				value: serializeValue(value),
				type: typeOf(value),
			};
			count++;
		}

		const hashParts: Array<string | number | boolean> = ["attributes", instancePath, count];
		const sortedNames: string[] = [];
		for (const [n] of pairs(serializedAttributes)) sortedNames.push(n as string);
		sortedNames.sort();
		for (const n of sortedNames) {
			hashParts.push(n);
			hashParts.push(serializedAttributes[n].type);
			hashParts.push(tostring(serializedAttributes[n].value));
		}
		const hash = Hashing.fingerprint(hashParts);
		if (count === 0) return { attributes: {}, knownHash: hash };
		return { attributes: serializedAttributes, count, knownHash: hash };
	});

	if (success) {
		const r = result as Record<string, unknown>;
		if (knownHash !== undefined && knownHash === r.knownHash) {
			return { unchanged: true, knownHash: r.knownHash };
		}
		return r;
	}
	return { error: `Failed to get attributes: ${result}`, errorCode: "attribute_read_failed" };
}

function deleteAttribute(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributeName = requestData.attributeName as string;

	if (!instancePath || !attributeName) {
		return { error: "Instance path and attribute name are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };
	const recordingId = beginRecording(`Delete attribute ${attributeName} from ${instance.Name}`);

	const [success, result] = pcall(() => {
		const existed = instance.GetAttribute(attributeName) !== undefined;
		instance.SetAttribute(attributeName, undefined);

		return {
			success: true, instancePath, attributeName, existed,
			message: existed ? "Attribute deleted successfully" : "Attribute did not exist",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to delete attribute: ${result}`, errorCode: "attribute_delete_failed" };
}

function getTags(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required", errorCode: "missing_arg", argName: "instancePath" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };

	const [success, result] = pcall(() => {
		const tags = CollectionService.GetTags(instance);
		return { instancePath, tags, count: tags.size() };
	});

	if (success) return result;
	return { error: `Failed to get tags: ${result}`, errorCode: "tag_read_failed" };
}

function addTag(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const tagName = requestData.tagName as string;

	if (!instancePath || !tagName) {
		return { error: "Instance path and tag name are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };
	const recordingId = beginRecording(`Add tag ${tagName} to ${instance.Name}`);

	const [success, result] = pcall(() => {
		const alreadyHad = CollectionService.HasTag(instance, tagName);
		CollectionService.AddTag(instance, tagName);

		return {
			success: true, instancePath, tagName, alreadyHad,
			message: alreadyHad ? "Instance already had this tag" : "Tag added successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to add tag: ${result}`, errorCode: "tag_write_failed" };
}

function removeTag(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const tagName = requestData.tagName as string;

	if (!instancePath || !tagName) {
		return { error: "Instance path and tag name are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };
	const recordingId = beginRecording(`Remove tag ${tagName} from ${instance.Name}`);

	const [success, result] = pcall(() => {
		const hadTag = CollectionService.HasTag(instance, tagName);
		CollectionService.RemoveTag(instance, tagName);

		return {
			success: true, instancePath, tagName, hadTag,
			message: hadTag ? "Tag removed successfully" : "Instance did not have this tag",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to remove tag: ${result}`, errorCode: "tag_remove_failed" };
}

function getTagged(requestData: Record<string, unknown>) {
	const tagName = requestData.tagName as string;
	if (!tagName) return { error: "Tag name is required", errorCode: "missing_arg", argName: "tagName" };

	const [success, result] = pcall(() => {
		const taggedInstances = CollectionService.GetTagged(tagName);
		const instances = taggedInstances.map((instance) => ({
			name: instance.Name,
			className: instance.ClassName,
			path: getInstancePath(instance),
		}));

		return { tagName, instances, count: instances.size() };
	});

	if (success) return result;
	return { error: `Failed to get tagged instances: ${result}`, errorCode: "tag_query_failed" };
}

function getSelection(_requestData: Record<string, unknown>) {
	const selection = Selection.Get();

	if (selection.size() === 0) {
		return { success: true, selection: [], count: 0, message: "No objects selected" };
	}

	const selectedObjects = selection.map((instance: Instance) => ({
		name: instance.Name,
		className: instance.ClassName,
		path: getInstancePath(instance),
		parent: instance.Parent ? getInstancePath(instance.Parent) : undefined,
	}));

	return {
		success: true,
		selection: selectedObjects,
		count: selection.size(),
		message: `${selection.size()} object(s) selected`,
	};
}

function executeLuau(requestData: Record<string, unknown>) {
	const code = requestData.code as string;
	if (!code || code === "") return { error: "Code is required", errorCode: "missing_arg", argName: "code" };

	const output: string[] = [];
	const oldPrint = print;
	const oldWarn = warn;

	const env = getfenv(0) as unknown as Record<string, unknown>;
	env["print"] = (...args: defined[]) => {
		const parts: string[] = [];
		for (const a of args) parts.push(tostring(a));
		output.push(parts.join("\t"));
		oldPrint(...(args as [defined, ...defined[]]));
	};
	env["warn"] = (...args: defined[]) => {
		const parts: string[] = [];
		for (const a of args) parts.push(tostring(a));
		output.push(`[warn] ${parts.join("\t")}`);
		oldWarn(...(args as [defined, ...defined[]]));
	};

	const [fn, compileError] = loadstring(code, "=execute_luau");
	if (!fn) {
		env["print"] = oldPrint;
		env["warn"] = oldWarn;
		return {
			success: false,
			error: tostring(compileError),
			errorCode: "luau_compile_error",
			output,
		};
	}

	const [success, result] = xpcall(
		() => fn(),
		(err: unknown) => {
			const msg = tostring(err);
			const trace = debug.traceback(undefined, 2);
			return `${msg}\n${trace}`;
		},
	);

	env["print"] = oldPrint;
	env["warn"] = oldWarn;

	if (success) {
		const response: Record<string, unknown> = { success: true, output };
		if (result !== undefined) {
			const encoded = safeJsonEncode(result, 0);
			if (encoded.ok) {
				response.returnValue = encoded.value;
				response.returnType = typeOf(result);
			} else {
				response.returnValue = tostring(result);
				response.returnType = typeOf(result);
				response.returnSerializationNote = encoded.reason;
			}
		}
		return response;
	} else {
		return {
			success: false,
			error: tostring(result),
			errorCode: "luau_runtime_error",
			output,
		};
	}
}

function undo(_requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Undo();
		return { success: true };
	});

	if (success) return result;
	return { error: `Failed to undo: ${result}`, errorCode: "undo_failed" };
}

function redo(_requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Redo();
		return { success: true };
	});

	if (success) return result;
	return { error: `Failed to redo: ${result}` };
}

function bulkSetAttributes(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributes = requestData.attributes as Record<string, unknown>;

	if (!instancePath || !attributes) {
		return { error: "Instance path and attributes are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };

	const recordingId = beginRecording(`Bulk set attributes on ${instance.Name}`);

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const [name, rawValue] of pairs(attributes)) {
		const attrName = name as string;
		const [ok, err] = pcall(() => {
			const value = deserializeValue(rawValue);
			instance.SetAttribute(attrName, value as AttributeValue);
		});

		if (ok) {
			successCount++;
			results.push({ attributeName: attrName, success: true });
		} else {
			failureCount++;
			results.push({ attributeName: attrName, success: false, error: tostring(err) });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		instancePath,
		results,
		summary: { total: successCount + failureCount, succeeded: successCount, failed: failureCount },
	};
}

export = {
	getAttribute,
	setAttribute,
	getAttributes,
	deleteAttribute,
	getTags,
	addTag,
	removeTag,
	getTagged,
	getSelection,
	executeLuau,
	undo,
	redo,
	bulkSetAttributes,
};
