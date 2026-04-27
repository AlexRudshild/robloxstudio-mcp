import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath, convertPropertyValue } = Utils;
const { beginRecording, finishRecording } = Recording;

type ProcessedCreateResult =
	| {
		instance: Instance;
		className: string;
		parentPath: string;
	}
	| {
		error: string;
		className?: string;
		parentPath?: string;
	};

type ProcessedBatchResult = {
	results: Record<string, unknown>[];
	successCount: number;
	failureCount: number;
};

function processObjectEntries(
	objects: Record<string, unknown>[],
	createFn: (objData: Record<string, unknown>) => ProcessedCreateResult,
): ProcessedBatchResult {
	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	const [loopSuccess, loopError] = pcall(() => {
		for (const entry of objects) {
			if (!typeIs(entry, "table")) {
				failureCount++;
				results.push({ success: false, error: "Each object entry must be a table" });
				continue;
			}

			const objData = entry as Record<string, unknown>;
			const className = objData.className as string;
			const parentPath = objData.parent as string;

			if (!className || !parentPath) {
				failureCount++;
				results.push({ success: false, error: "Class name and parent are required" });
				continue;
			}

			const [entrySuccess, entryResult] = pcall(() => createFn(objData));
			if (!entrySuccess) {
				failureCount++;
				results.push({ success: false, className, parent: parentPath, error: tostring(entryResult) });
				continue;
			}

			if ("instance" in entryResult) {
				successCount++;
				results.push({
					success: true,
					className: entryResult.className,
					parent: entryResult.parentPath,
					instancePath: getInstancePath(entryResult.instance),
					name: entryResult.instance.Name,
				});
			} else {
				failureCount++;
				results.push({
					success: false,
					className: entryResult.className ?? className,
					parent: entryResult.parentPath ?? parentPath,
					error: entryResult.error,
				});
			}
		}
	});

	if (!loopSuccess) {
		failureCount++;
		results.push({ success: false, error: `Unexpected mass create failure: ${tostring(loopError)}` });
	}

	return { results, successCount, failureCount };
}

function createObject(requestData: Record<string, unknown>) {
	const className = requestData.className as string;
	const parentPath = requestData.parent as string;
	const name = requestData.name as string | undefined;
	const properties = (requestData.properties as Record<string, unknown>) ?? {};

	if (!className || !parentPath) {
		return { error: "Class name and parent are required", errorCode: "missing_arg" };
	}

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent instance not found: ${parentPath}. Use search() or get_project_structure() to find a valid parent path.`, errorCode: "parent_not_found", parentPath };
	const recordingId = beginRecording(`Create ${className}`);

	const [success, newInstance] = pcall(() => {
		const instance = new Instance(className as keyof CreatableInstances);
		if (name) instance.Name = name;

		for (const [propertyName, propertyValue] of pairs(properties)) {
			pcall(() => {
				const converted = convertPropertyValue(instance, propertyName as string, propertyValue);
				(instance as unknown as { [key: string]: unknown })[propertyName as string] =
					converted !== undefined ? converted : propertyValue;
			});
		}

		instance.Parent = parentInstance;
		return instance;
	});

	if (success && newInstance) {
		finishRecording(recordingId, true);
		return {
			success: true,
			className,
			parent: parentPath,
			instancePath: getInstancePath(newInstance as Instance),
			name: (newInstance as Instance).Name,
		};
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to create object: ${newInstance}. Class may not be creatable from script, or parent may not accept this child type.`, errorCode: "create_failed", className, parentPath };
	}
}

function deleteObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required", errorCode: "missing_arg", argName: "instancePath" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };
	if (instance === game) return { error: "Cannot delete the game instance", errorCode: "delete_protected" };
	const recordingId = beginRecording(`Delete ${instance.ClassName} (${instance.Name})`);

	const [success, result] = pcall(() => {
		instance.Destroy();
		return true;
	});

	if (success) {
		finishRecording(recordingId, true);
		return { success: true, instancePath };
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to delete object: ${result}`, errorCode: "delete_failed", instancePath };
	}
}

function massCreateObjects(requestData: Record<string, unknown>) {
	const objects = requestData.objects as Record<string, unknown>[];
	if (!objects || !typeIs(objects, "table") || (objects as defined[]).size() === 0) {
		return { error: "Objects array is required", errorCode: "missing_arg" };
	}

	const recordingId = beginRecording("Mass create objects");

	const { results, successCount, failureCount } = processObjectEntries(objects, (objData) => {
		const className = objData.className as string;
		const parentPath = objData.parent as string;
		const name = objData.name as string | undefined;
		const properties = (objData.properties as Record<string, unknown>) ?? {};
		const parentInstance = getInstanceByPath(parentPath);
		if (!parentInstance) {
			return { error: "Parent instance not found", errorCode: "parent_not_found", className, parentPath };
		}

		const [success, newInstance] = pcall(() => {
			const instance = new Instance(className as keyof CreatableInstances);
			if (name) instance.Name = name;
			for (const [propertyName, propertyValue] of pairs(properties)) {
				pcall(() => {
					const converted = convertPropertyValue(instance, propertyName as string, propertyValue);
					(instance as unknown as { [key: string]: unknown })[propertyName as string] =
						converted !== undefined ? converted : propertyValue;
				});
			}
			instance.Parent = parentInstance;
			return instance;
		});

		if (!success || !newInstance) {
			return { error: tostring(newInstance), errorCode: "create_failed", className, parentPath };
		}

		return { instance: newInstance as Instance, className, parentPath };
	});

	finishRecording(recordingId, successCount > 0);
	return { results, summary: { total: (objects as defined[]).size(), succeeded: successCount, failed: failureCount } };
}



function performSmartDuplicate(requestData: Record<string, unknown>, useRecording = true) {
	const instancePath = requestData.instancePath as string;
	const count = requestData.count as number;
	const options = (requestData.options as Record<string, unknown>) ?? {};

	if (!instancePath || !count || count < 1) {
		return { error: "Instance path and count > 0 are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };
	const recordingId = useRecording ? beginRecording(`Smart duplicate ${instance.Name}`) : undefined;

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (let i = 1; i <= count; i++) {
		const [success, newInstance] = pcall(() => {
			const clone = instance.Clone();

			if (options.namePattern) {
				clone.Name = (options.namePattern as string).gsub("{n}", tostring(i))[0];
			} else {
				clone.Name = instance.Name + i;
			}

			if (options.positionOffset && clone.IsA("BasePart")) {
				const offset = options.positionOffset as number[];
				const currentPos = clone.Position;
				clone.Position = new Vector3(
					currentPos.X + ((offset[0] ?? 0) as number) * i,
					currentPos.Y + ((offset[1] ?? 0) as number) * i,
					currentPos.Z + ((offset[2] ?? 0) as number) * i,
				);
			}

			if (options.rotationOffset && clone.IsA("BasePart")) {
				const offset = options.rotationOffset as number[];
				clone.CFrame = clone.CFrame.mul(CFrame.Angles(
					math.rad(((offset[0] ?? 0) as number) * i),
					math.rad(((offset[1] ?? 0) as number) * i),
					math.rad(((offset[2] ?? 0) as number) * i),
				));
			}

			if (options.scaleOffset && clone.IsA("BasePart")) {
				const offset = options.scaleOffset as number[];
				const currentSize = clone.Size;
				clone.Size = new Vector3(
					currentSize.X * (((offset[0] ?? 1) as number) ** i),
					currentSize.Y * (((offset[1] ?? 1) as number) ** i),
					currentSize.Z * (((offset[2] ?? 1) as number) ** i),
				);
			}

			if (options.propertyVariations) {
				for (const [propName, values] of pairs(options.propertyVariations as Record<string, unknown[]>)) {
					if (values && (values as defined[]).size() > 0) {
						const valueIndex = ((i - 1) % (values as defined[]).size());
						pcall(() => {
							(clone as unknown as { [key: string]: unknown })[propName as string] = (values as unknown[])[valueIndex];
						});
					}
				}
			}

			const targetParents = options.targetParents as string[] | undefined;
			if (targetParents && targetParents[i - 1]) {
				const targetParent = getInstanceByPath(targetParents[i - 1]);
				clone.Parent = targetParent ?? instance.Parent;
			} else {
				clone.Parent = instance.Parent;
			}

			return clone;
		});

		if (success && newInstance) {
			successCount++;
			results.push({
				success: true,
				instancePath: getInstancePath(newInstance as Instance),
				name: (newInstance as Instance).Name,
				index: i,
			});
		} else {
			failureCount++;
			results.push({ success: false, index: i, error: tostring(newInstance) });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		results,
		summary: { total: count, succeeded: successCount, failed: failureCount },
		sourceInstance: instancePath,
	};
}

function smartDuplicate(requestData: Record<string, unknown>) {
	return performSmartDuplicate(requestData, true);
}

function massDuplicate(requestData: Record<string, unknown>) {
	const duplications = requestData.duplications as Record<string, unknown>[];
	if (!duplications || !typeIs(duplications, "table") || (duplications as defined[]).size() === 0) {
		return { error: "Duplications array is required", errorCode: "missing_arg" };
	}

	const allResults: Record<string, unknown>[] = [];
	let totalSuccess = 0;
	let totalFailures = 0;
	const recordingId = beginRecording("Mass duplicate operations");

	for (const duplication of duplications) {
		const result = performSmartDuplicate(duplication, false) as { summary?: { succeeded: number; failed: number } };
		allResults.push(result as unknown as Record<string, unknown>);
		if (result.summary) {
			totalSuccess += result.summary.succeeded;
			totalFailures += result.summary.failed;
		}
	}

	finishRecording(recordingId, totalSuccess > 0);

	return {
		results: allResults,
		summary: { total: totalSuccess + totalFailures, succeeded: totalSuccess, failed: totalFailures },
	};
}

function cloneObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const targetParentPath = requestData.targetParentPath as string;

	if (!instancePath || !targetParentPath) {
		return { error: "Instance path and target parent path are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };

	const targetParent = getInstanceByPath(targetParentPath);
	if (!targetParent) return { error: `Target parent not found: ${targetParentPath}`, errorCode: "parent_not_found", targetParentPath };

	const recordingId = beginRecording(`Clone ${instance.Name}`);

	const [success, clone] = pcall(() => {
		const cloned = instance.Clone();
		cloned.Parent = targetParent;
		return cloned;
	});

	if (success && clone) {
		finishRecording(recordingId, true);
		return {
			success: true,
			instancePath: getInstancePath(clone as Instance),
			name: (clone as Instance).Name,
			className: (clone as Instance).ClassName,
			parent: targetParentPath,
		};
	}
	finishRecording(recordingId, false);
	return { error: `Failed to clone object: ${clone}`, errorCode: "clone_failed" };
}

function moveObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const targetParentPath = requestData.targetParentPath as string;

	if (!instancePath || !targetParentPath) {
		return { error: "Instance path and target parent path are required", errorCode: "missing_arg" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}. Use search() to find by name.`, errorCode: "instance_not_found", instancePath };

	const targetParent = getInstanceByPath(targetParentPath);
	if (!targetParent) return { error: `Target parent not found: ${targetParentPath}`, errorCode: "parent_not_found", targetParentPath };

	const recordingId = beginRecording(`Move ${instance.Name}`);

	const [success, result] = pcall(() => {
		instance.Parent = targetParent;
		return true;
	});

	if (success) {
		finishRecording(recordingId, true);
		return {
			success: true,
			instancePath: getInstancePath(instance),
			name: instance.Name,
			className: instance.ClassName,
			parent: targetParentPath,
		};
	}
	finishRecording(recordingId, false);
	return { error: `Failed to move object: ${result}`, errorCode: "move_failed" };
}

function createUITree(requestData: Record<string, unknown>) {
	const tree = requestData.tree as Record<string, unknown>;
	const parentPath = requestData.parentPath as string;

	if (!tree || !parentPath) {
		return { error: "Tree object and parentPath are required", errorCode: "missing_arg" };
	}

	const parent = getInstanceByPath(parentPath);
	if (!parent) return { error: `Parent not found: ${parentPath}`, errorCode: "parent_not_found", parentPath };

	if (!tree.className || !typeIs(tree.className, "string")) {
		return { error: "Tree root must have a className string", errorCode: "invalid_arg" };
	}

	const MAX_DEPTH = 20;
	const recordingId = beginRecording("Create UI tree");
	let totalCreated = 0;
	let totalFailed = 0;
	const errors: string[] = [];

	function createNode(nodeData: Record<string, unknown>, nodeParent: Instance, depth: number): Instance | undefined {
		if (depth > MAX_DEPTH) {
			totalFailed++;
			errors.push(`Max depth (${MAX_DEPTH}) exceeded`);
			return undefined;
		}

		const className = nodeData.className as string;
		if (!className) {
			totalFailed++;
			errors.push("Node missing className");
			return undefined;
		}

		const [success, instance] = pcall(() => {
			const inst = new Instance(className as keyof CreatableInstances);
			if (nodeData.name) inst.Name = nodeData.name as string;

			const props = nodeData.properties as Record<string, unknown> | undefined;
			if (props && typeIs(props, "table")) {
				for (const [propName, propValue] of pairs(props)) {
					pcall(() => {
						const converted = convertPropertyValue(inst, propName as string, propValue);
						(inst as unknown as Record<string, unknown>)[propName as string] =
							converted !== undefined ? converted : propValue;
					});
				}
			}

			inst.Parent = nodeParent;
			return inst;
		});

		if (!success || !instance) {
			totalFailed++;
			errors.push(`Failed to create ${className}: ${tostring(instance)}`);
			return undefined;
		}
		totalCreated++;

		const children = nodeData.children as Record<string, unknown>[] | undefined;
		if (children && typeIs(children, "table")) {
			for (const childData of children) {
				if (typeIs(childData, "table")) {
					createNode(childData as Record<string, unknown>, instance as Instance, depth + 1);
				}
			}
		}

		return instance as Instance;
	}

	const rootInstance = createNode(tree, parent, 0);
	finishRecording(recordingId, totalCreated > 0);

	if (!rootInstance) {
		return {
			error: `Failed to create root node (${tree.className})`,
			totalCreated,
			totalFailed,
			errors,
		};
	}

	return {
		totalCreated,
		totalFailed,
		rootPath: getInstancePath(rootInstance),
		errors: errors.size() > 0 ? errors : undefined,
	};
}

export = {
	createObject,
	deleteObject,
	massCreateObjects,
	smartDuplicate,
	massDuplicate,
	cloneObject,
	moveObject,
	createUITree,
};
