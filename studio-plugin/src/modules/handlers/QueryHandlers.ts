import Utils from "../Utils";
import Hashing from "../Hashing";

const { getInstancePath, getInstanceByPath, readScriptSource } = Utils;

const defaultInstanceCache: Record<string, Instance | false> = {};

function getDefaultInstance(className: string): Instance | undefined {
	const cached = defaultInstanceCache[className];
	if (cached === false) return undefined;
	if (cached !== undefined) return cached;

	const [ok, result] = pcall(() => new Instance(className as keyof CreatableInstances));
	if (!ok) {
		defaultInstanceCache[className] = false;
		return undefined;
	}
	const inst = result as Instance;
	inst.Parent = undefined;
	defaultInstanceCache[className] = inst;
	return inst;
}

function formatPropValue(val: unknown): unknown {
	const t = typeOf(val);
	if (t === "boolean" || t === "number" || t === "string" || t === "nil") return val;
	if (t === "UDim2") {
		const udim = val as UDim2;
		return {
			X: { Scale: udim.X.Scale, Offset: udim.X.Offset },
			Y: { Scale: udim.Y.Scale, Offset: udim.Y.Offset },
			_type: "UDim2",
		};
	}
	if (t === "Vector3") {
		const v = val as Vector3;
		return { X: v.X, Y: v.Y, Z: v.Z, _type: "Vector3" };
	}
	if (t === "Vector2") {
		const v = val as Vector2;
		return { X: v.X, Y: v.Y, _type: "Vector2" };
	}
	if (t === "Color3") {
		const c = val as Color3;
		return { R: c.R, G: c.G, B: c.B, _type: "Color3" };
	}
	if (t === "UDim") {
		const u = val as UDim;
		return { Scale: u.Scale, Offset: u.Offset, _type: "UDim" };
	}
	if (t === "CFrame") {
		const cf = val as CFrame;
		const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf.GetComponents();
		return {
			Position: { X: x, Y: y, Z: z },
			Rotation: [r00, r01, r02, r10, r11, r12, r20, r21, r22],
			_type: "CFrame",
		};
	}
	if (t === "BrickColor") {
		const bc = val as BrickColor;
		return { Name: bc.Name, _type: "BrickColor" };
	}
	if (t === "EnumItem") {
		const e = val as EnumItem;
		return { Name: e.Name, EnumType: tostring(e.EnumType), Value: e.Value, _type: "EnumItem" };
	}
	if (t === "Instance") {
		return { Path: getInstancePath(val as Instance), _type: "Instance" };
	}
	if (t === "NumberRange") {
		const nr = val as NumberRange;
		return { Min: nr.Min, Max: nr.Max, _type: "NumberRange" };
	}
	if (t === "Rect") {
		const r = val as Rect;
		return { Min: { X: r.Min.X, Y: r.Min.Y }, Max: { X: r.Max.X, Y: r.Max.Y }, _type: "Rect" };
	}
	return tostring(val);
}

function serializePropForHash(val: unknown): string {
	if (val === undefined) return "nil";
	if (typeIs(val, "table")) {
		const t = val as Record<string, unknown>;
		const typeTag = t._type as string | undefined;
		if (typeTag === undefined) return "table";
		if (typeTag === "UDim2") {
			const x = t.X as Record<string, number>;
			const y = t.Y as Record<string, number>;
			return `UDim2(${x.Scale},${x.Offset},${y.Scale},${y.Offset})`;
		}
		if (typeTag === "Vector3") return `V3(${t.X},${t.Y},${t.Z})`;
		if (typeTag === "Vector2") return `V2(${t.X},${t.Y})`;
		if (typeTag === "Color3") return `C3(${t.R},${t.G},${t.B})`;
		if (typeTag === "UDim") return `UDim(${t.Scale},${t.Offset})`;
		if (typeTag === "CFrame") {
			const p = t.Position as Record<string, number>;
			const r = t.Rotation as number[];
			return `CFrame(${p.X},${p.Y},${p.Z},${r.join(",")})`;
		}
		if (typeTag === "BrickColor") return `BrickColor(${t.Name})`;
		if (typeTag === "EnumItem") return `Enum(${t.EnumType}.${t.Name})`;
		if (typeTag === "Instance") return `Instance(${t.Path})`;
		if (typeTag === "NumberRange") return `NumberRange(${t.Min},${t.Max})`;
		if (typeTag === "Rect") {
			const min = t.Min as Record<string, number>;
			const max = t.Max as Record<string, number>;
			return `Rect(${min.X},${min.Y},${max.X},${max.Y})`;
		}
		return `${typeTag}-table`;
	}
	return tostring(val);
}

function hashProperties(instancePath: string, mode: string, props: Record<string, unknown>): string {
	const keys: string[] = [];
	for (const [k] of pairs(props)) {
		keys.push(k as string);
	}
	keys.sort();
	const parts: Array<string | number | boolean> = ["instance-props", instancePath, mode];
	for (const k of keys) {
		parts.push(k);
		parts.push(serializePropForHash(props[k]));
	}
	return Hashing.fingerprint(parts);
}

interface TreeNode {
	name: string;
	className: string;
	path?: string;
	children: TreeNode[];
	hasSource?: boolean;
	scriptType?: string;
	enabled?: boolean;
}

function getFileTree(requestData: Record<string, unknown>) {
	const path = (requestData.path as string) ?? "";
	const startInstance = getInstanceByPath(path);

	if (!startInstance) {
		return { error: `Path not found: ${path}. Paths use dot-notation starting with 'game' (e.g. 'game.Workspace.Folder').`, errorCode: "path_not_found", path };
	}

	function buildTree(instance: Instance, depth: number): TreeNode {
		if (depth > 10) {
			return { name: instance.Name, className: instance.ClassName, children: [] };
		}

		const node: TreeNode = {
			name: instance.Name,
			className: instance.ClassName,
			path: getInstancePath(instance),
			children: [],
		};

		if (instance.IsA("LuaSourceContainer")) {
			node.hasSource = true;
			node.scriptType = instance.ClassName;
			if (instance.IsA("BaseScript")) {
				node.enabled = instance.Enabled;
			}
		}

		for (const child of instance.GetChildren()) {
			node.children.push(buildTree(child, depth + 1));
		}

		return node;
	}

	return {
		tree: buildTree(startInstance, 0),
		timestamp: tick(),
	};
}

function searchFiles(requestData: Record<string, unknown>) {
	const query = requestData.query as string;
	const searchType = (requestData.searchType as string) ?? "name";

	if (!query) return { error: "Query is required", errorCode: "missing_arg", argName: "query" };

	const results: { name: string; className: string; path: string; hasSource: boolean; enabled?: boolean }[] = [];

	function searchRecursive(instance: Instance) {
		let match = false;

		if (searchType === "name") {
			match = instance.Name.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "type") {
			match = instance.ClassName.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "content" && instance.IsA("LuaSourceContainer")) {
			match = readScriptSource(instance).lower().find(query.lower())[0] !== undefined;
		}

		if (match) {
			const entry: { name: string; className: string; path: string; hasSource: boolean; enabled?: boolean } = {
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
				hasSource: instance.IsA("LuaSourceContainer"),
			};
			if (instance.IsA("BaseScript")) {
				entry.enabled = instance.Enabled;
			}
			results.push(entry);
		}

		for (const child of instance.GetChildren()) {
			searchRecursive(child);
		}
	}

	searchRecursive(game);

	return { results };
}

function getPlaceInfo(_requestData: Record<string, unknown>) {
	return {
		placeName: game.Name,
		placeId: game.PlaceId,
		gameId: game.GameId,
		jobId: game.JobId,
		workspace: {
			name: game.Workspace.Name,
			className: game.Workspace.ClassName,
		},
	};
}

function getServices(requestData: Record<string, unknown>) {
	const serviceName = requestData.serviceName as string | undefined;

	if (serviceName) {
		const [ok, service] = pcall(() => game.GetService(serviceName as keyof Services));
		if (ok && service) {
			return {
				service: {
					name: service.Name,
					className: service.ClassName,
					path: getInstancePath(service as Instance),
					childCount: (service as Instance).GetChildren().size(),
				},
			};
		} else {
			return { error: `Service not found: ${serviceName}`, errorCode: "service_not_found", serviceName };
		}
	} else {
		const services: { name: string; className: string; path: string; childCount: number }[] = [];
		const commonServices = [
			"Workspace", "Players", "StarterGui", "StarterPack", "StarterPlayer",
			"ReplicatedStorage", "ServerStorage", "ServerScriptService",
			"HttpService", "TeleportService", "DataStoreService",
		];

		for (const svcName of commonServices) {
			const [ok, service] = pcall(() => game.GetService(svcName as keyof Services));
			if (ok && service) {
				services.push({
					name: service.Name,
					className: service.ClassName,
					path: getInstancePath(service as Instance),
					childCount: (service as Instance).GetChildren().size(),
				});
			}
		}

		return { services };
	}
}

function searchObjects(requestData: Record<string, unknown>) {
	const query = requestData.query as string;
	const searchType = (requestData.searchType as string) ?? "name";
	const propertyName = requestData.propertyName as string | undefined;

	if (!query) return { error: "Query is required", errorCode: "missing_arg", argName: "query" };

	const results: { name: string; className: string; path: string }[] = [];

	function searchRecursive(instance: Instance) {
		let match = false;

		if (searchType === "name") {
			match = instance.Name.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "class") {
			match = instance.ClassName.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "property" && propertyName) {
			const [success, value] = pcall(() => tostring((instance as unknown as Record<string, unknown>)[propertyName]));
			if (success) {
				match = (value as string).lower().find(query.lower())[0] !== undefined;
			}
		}

		if (match) {
			results.push({
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
			});
		}

		for (const child of instance.GetChildren()) {
			searchRecursive(child);
		}
	}

	searchRecursive(game);

	return { results };
}

function getInstanceProperties(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const excludeSource = (requestData.excludeSource as boolean) ?? false;
	const requestedMode = (requestData.mode as string) ?? "delta";
	const knownHash = requestData.knownHash as string | undefined;
	if (!instancePath) return { error: "Instance path is required", errorCode: "missing_arg", argName: "instancePath" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: "Instance not found", errorCode: "instance_not_found", instancePath, hint: "Use search() or get_project_structure to locate." };

	const defaultInstance = requestedMode === "delta" ? getDefaultInstance(instance.ClassName) : undefined;
	const effectiveMode = defaultInstance !== undefined ? "delta" : "full";

	const properties: Record<string, unknown> = {};
	let omittedDefaultCount = 0;

	const [success, result] = pcall(() => {
		// Identity props — always included regardless of mode.
		properties.Name = instance.Name;
		properties.ClassName = instance.ClassName;
		const parentVal = instance.Parent;
		properties.Parent = parentVal ? getInstancePath(parentVal) : "nil";

		const commonProps = [
			"Size", "Position", "Rotation", "CFrame", "Anchored", "CanCollide",
			"Transparency", "Material", "Color", "Text", "TextColor3",
			"BackgroundColor3", "Image", "ImageColor3", "Visible", "Active", "ZIndex",
			"BorderSizePixel", "BackgroundTransparency", "ImageTransparency",
			"TextTransparency", "Value", "Enabled", "Brightness", "Range", "Shadows",
			"Face", "SurfaceType",
		];

		for (const prop of commonProps) {
			const [okCur, curVal] = pcall(() => (instance as unknown as Record<string, unknown>)[prop]);
			if (!okCur) continue;

			if (effectiveMode === "delta") {
				const [okDef, defVal] = pcall(() => (defaultInstance as unknown as Record<string, unknown>)[prop]);
				if (okDef && (curVal as defined) === (defVal as defined)) {
					omittedDefaultCount++;
					continue;
				}
			}

			properties[prop] = formatPropValue(curVal);
		}

		if (instance.IsA("LuaSourceContainer")) {
			// Source always included (model needs it; treating it as identity).
			if (!excludeSource) {
				properties.Source = readScriptSource(instance);
			} else {
				const src = readScriptSource(instance);
				properties.SourceLength = src.size();
				properties.LineCount = Utils.splitLines(src)[0].size();
			}
			if (instance.IsA("BaseScript")) {
				properties.Enabled = instance.Enabled;
				const [okRunCtx, runCtx] = pcall(() => (instance as unknown as Record<string, unknown>).RunContext);
				if (okRunCtx && runCtx !== undefined) {
					properties.RunContext = formatPropValue(runCtx);
				}
			}
		}

		const classSpecific: Array<[boolean, string, () => unknown]> = [
			[instance.IsA("Part"), "Shape", () => formatPropValue((instance as Part).Shape)],
			[instance.IsA("BasePart"), "TopSurface", () => formatPropValue((instance as BasePart).TopSurface)],
			[instance.IsA("BasePart"), "BottomSurface", () => formatPropValue((instance as BasePart).BottomSurface)],
			[instance.IsA("MeshPart"), "MeshId", () => (instance as MeshPart).MeshId],
			[instance.IsA("MeshPart"), "TextureID", () => (instance as MeshPart).TextureID],
			[instance.IsA("SpecialMesh"), "MeshId", () => (instance as SpecialMesh).MeshId],
			[instance.IsA("SpecialMesh"), "TextureId", () => (instance as SpecialMesh).TextureId],
			[instance.IsA("SpecialMesh"), "MeshType", () => formatPropValue((instance as SpecialMesh).MeshType)],
			[instance.IsA("Sound"), "SoundId", () => (instance as Sound).SoundId],
			[instance.IsA("Sound"), "TimeLength", () => (instance as Sound).TimeLength],
			[instance.IsA("Sound"), "IsPlaying", () => (instance as Sound).IsPlaying],
			[instance.IsA("Animation"), "AnimationId", () => (instance as Animation).AnimationId],
			[instance.IsA("Decal") || instance.IsA("Texture"), "Texture", () => (instance as Decal | Texture).Texture],
			[instance.IsA("Shirt"), "ShirtTemplate", () => (instance as Shirt).ShirtTemplate],
			[instance.IsA("Pants"), "PantsTemplate", () => (instance as Pants).PantsTemplate],
			[instance.IsA("ShirtGraphic"), "Graphic", () => (instance as ShirtGraphic).Graphic],
		];

		for (const [applies, prop, getter] of classSpecific) {
			if (!applies || properties[prop] !== undefined) continue;
			const [okCur, curVal] = pcall(() => (instance as unknown as Record<string, unknown>)[prop]);
			if (!okCur) continue;

			if (effectiveMode === "delta") {
				const [okDef, defVal] = pcall(() => (defaultInstance as unknown as Record<string, unknown>)[prop]);
				if (okDef && (curVal as defined) === (defVal as defined)) {
					omittedDefaultCount++;
					continue;
				}
			}
			properties[prop] = getter();
		}

		const childCount = instance.GetChildren().size();
		if (childCount > 0) {
			properties.ChildCount = childCount;
		} else if (effectiveMode === "delta") {
			omittedDefaultCount++;
		} else {
			properties.ChildCount = 0;
		}
	});

	if (success) {
		const hash = hashProperties(instancePath, effectiveMode, properties);
		if (knownHash !== undefined && knownHash === hash) {
			return { unchanged: true, knownHash: hash };
		}
		const resp: Record<string, unknown> = {
			instancePath,
			className: instance.ClassName,
			properties,
			mode: effectiveMode,
			knownHash: hash,
		};
		if (effectiveMode === "delta") {
			resp.omittedDefaultCount = omittedDefaultCount;
			if (omittedDefaultCount === 0) {
				resp.deltaNote = "all properties shown (no defaults matched)";
			}
		} else if (requestedMode === "delta") {
			resp.deltaNote = "delta unavailable for this className; full mode used";
		}
		return resp;
	} else {
		return { error: `Failed to get properties: ${result}`, errorCode: "property_read_failed", instancePath };
	}
}

function getInstanceChildren(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const knownHash = requestData.knownHash as string | undefined;
	if (!instancePath) return { error: "Instance path is required", errorCode: "missing_arg", argName: "instancePath" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: "Instance not found", errorCode: "instance_not_found", instancePath, hint: "Use search() or get_project_structure to locate." };

	const children: { name: string; className: string; path: string; hasChildren: boolean; hasSource: boolean; enabled?: boolean }[] = [];
	const hashParts: Array<string | number | boolean> = ["instance-children", instancePath];
	for (const child of instance.GetChildren()) {
		const entry: { name: string; className: string; path: string; hasChildren: boolean; hasSource: boolean; enabled?: boolean } = {
			name: child.Name,
			className: child.ClassName,
			path: getInstancePath(child),
			hasChildren: child.GetChildren().size() > 0,
			hasSource: child.IsA("LuaSourceContainer"),
		};
		if (child.IsA("BaseScript")) {
			entry.enabled = child.Enabled;
		}
		children.push(entry);
		hashParts.push(child.Name);
		hashParts.push(child.ClassName);
		hashParts.push(entry.hasChildren);
		hashParts.push(entry.enabled ?? false);
	}

	const hash = Hashing.fingerprint(hashParts);
	if (knownHash !== undefined && knownHash === hash) {
		return { unchanged: true, hash };
	}
	return { children, hash };
}

function searchByProperty(requestData: Record<string, unknown>) {
	const propertyName = requestData.propertyName as string;
	const propertyValue = requestData.propertyValue as string;

	if (!propertyName || !propertyValue) {
		return { error: "Property name and value are required", errorCode: "missing_arg" };
	}

	const results: { name: string; className: string; path: string; propertyValue: string }[] = [];

	function searchRecursive(instance: Instance) {
		const [success, value] = pcall(() => tostring((instance as unknown as Record<string, unknown>)[propertyName]));
		if (success && (value as string).lower().find(propertyValue.lower())[0] !== undefined) {
			results.push({
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
				propertyValue: value as string,
			});
		}
		for (const child of instance.GetChildren()) {
			searchRecursive(child);
		}
	}

	searchRecursive(game);
	return { results };
}

function hashTree(node: Record<string, unknown>): string {
	const parts: Array<string | number | boolean> = [];
	function walk(n: Record<string, unknown>) {
		parts.push(tostring(n.path ?? ""));
		parts.push(tostring(n.className ?? ""));
		parts.push(tostring(n.name ?? ""));
		const kids = n.children as Record<string, unknown>[] | undefined;
		if (kids) {
			parts.push(`#${kids.size()}`);
			for (const k of kids) walk(k);
		}
	}
	walk(node);
	return Hashing.fingerprint(parts);
}

function getProjectStructure(requestData: Record<string, unknown>) {
	const startPath = ((requestData.instancePath as string) ?? (requestData.path as string)) ?? "";
	const maxDepth = (requestData.maxDepth as number) ?? 3;
	const showScriptsOnly = (requestData.scriptsOnly as boolean) ?? false;
	const knownHash = requestData.knownHash as string | undefined;

	if (startPath === "" || startPath === "game") {
		const services: Record<string, unknown>[] = [];
		const mainServices = [
			"Workspace", "ServerScriptService", "ServerStorage", "ReplicatedStorage",
			"StarterGui", "StarterPack", "StarterPlayer", "Players",
		];

		for (const serviceName of mainServices) {
			const [svcOk, service] = pcall(() => game.GetService(serviceName as keyof Services));
			if (svcOk && service) {
				services.push({
					name: service.Name,
					className: service.ClassName,
					path: getInstancePath(service as Instance),
					childCount: (service as Instance).GetChildren().size(),
					hasChildren: (service as Instance).GetChildren().size() > 0,
				});
			}
		}

		const overviewParts: Array<string | number | boolean> = ["service_overview"];
		for (const s of services) {
			overviewParts.push(tostring(s.path ?? ""));
			overviewParts.push(tostring(s.childCount ?? 0));
		}
		const overviewHash = Hashing.fingerprint(overviewParts);
		if (knownHash !== undefined && knownHash === overviewHash) {
			return { unchanged: true, knownHash: overviewHash };
		}
		return {
			type: "service_overview",
			services,
			knownHash: overviewHash,
		};
	}

	const startInstance = getInstanceByPath(startPath);
	if (!startInstance) return { error: `Path not found: ${startPath}. Paths use dot-notation starting with 'game'.`, errorCode: "path_not_found", path: startPath };

	function getStructure(instance: Instance, depth: number): Record<string, unknown> {
		if (depth > maxDepth) {
			return {
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
				childCount: instance.GetChildren().size(),
				hasMore: true,
			};
		}

		const node: Record<string, unknown> = {
			name: instance.Name,
			className: instance.ClassName,
			path: getInstancePath(instance),
			children: [] as Record<string, unknown>[],
		};

		if (instance.IsA("LuaSourceContainer")) {
			node.hasSource = true;
			node.scriptType = instance.ClassName;
			if (instance.IsA("BaseScript")) {
				node.enabled = instance.Enabled;
			}
		}

		if (instance.IsA("GuiObject")) {
			node.visible = instance.Visible;
			if (instance.IsA("Frame") || instance.IsA("ScreenGui")) {
				node.guiType = "container";
			} else if (instance.IsA("TextLabel") || instance.IsA("TextButton")) {
				node.guiType = "text";
				const textInst = instance as TextLabel | TextButton;
				if (textInst.Text !== "") node.text = textInst.Text;
			} else if (instance.IsA("ImageLabel") || instance.IsA("ImageButton")) {
				node.guiType = "image";
			}
		}

		let children = instance.GetChildren();
		if (showScriptsOnly) {
			children = children.filter(
				(child) => child.IsA("BaseScript") || child.IsA("Folder") || child.IsA("ModuleScript"),
			);
		}

		const nodeChildren = node.children as Record<string, unknown>[];
		const childCount = children.size();
		if (childCount > 20 && depth < maxDepth) {
			const classGroups = new Map<string, Instance[]>();
			for (const child of children) {
				const cn = child.ClassName;
				if (!classGroups.has(cn)) classGroups.set(cn, []);
				classGroups.get(cn)!.push(child);
			}

			const childSummary: Record<string, unknown>[] = [];
			classGroups.forEach((classChildren, cn) => {
				childSummary.push({
					className: cn,
					count: classChildren.size(),
					examples: [classChildren[0]?.Name, classChildren[1]?.Name],
				});
			});
			node.childSummary = childSummary;

			classGroups.forEach((classChildren, cn) => {
				const limit = math.min(3, classChildren.size());
				for (let i = 0; i < limit; i++) {
					nodeChildren.push(getStructure(classChildren[i], depth + 1));
				}
				if (classChildren.size() > 3) {
					nodeChildren.push({
						name: `... ${classChildren.size() - 3} more ${cn} objects`,
						className: "MoreIndicator",
						path: `${getInstancePath(instance)} [${cn} children]`,
					});
				}
			});
		} else {
			for (const child of children) {
				nodeChildren.push(getStructure(child, depth + 1));
			}
		}

		return node;
	}

	const tree = getStructure(startInstance, 0);
	const treeHash = hashTree(tree);
	if (knownHash !== undefined && knownHash === treeHash) {
		return { unchanged: true, knownHash: treeHash };
	}
	tree.knownHash = treeHash;
	return tree;
}

function grepScripts(requestData: Record<string, unknown>) {
	const pattern = requestData.pattern as string;
	if (!pattern) return { error: "pattern is required", errorCode: "missing_arg", argName: "pattern" };

	const caseSensitive = (requestData.caseSensitive as boolean) ?? false;
	const contextLines = (requestData.contextLines as number) ?? 0;
	const maxResults = (requestData.maxResults as number) ?? 100;
	const maxResultsPerScript = (requestData.maxResultsPerScript as number) ?? 0;
	const usePattern = (requestData.usePattern as boolean) ?? false;
	const filesOnly = (requestData.filesOnly as boolean) ?? false;
	const searchPath = (requestData.path as string) ?? "";
	const classFilter = requestData.classFilter as string | undefined;

	const startInstance = searchPath !== "" ? getInstanceByPath(searchPath) : game;
	if (!startInstance) return { error: "Path not found", errorCode: "path_not_found", instancePath: searchPath, hint: "Use search() or get_project_structure to locate." };

	// Prepare pattern for matching
	const searchPattern = caseSensitive ? pattern : pattern.lower();

	interface LineMatch {
		line: number;
		column: number;
		text: string;
		before: string[];
		after: string[];
	}

	interface ScriptResult {
		instancePath: string;
		name: string;
		className: string;
		enabled?: boolean;
		matches: LineMatch[];
	}

	const results: ScriptResult[] = [];
	let totalMatches = 0;
	let scriptsSearched = 0;
	let hitLimit = false;

	function searchInstance(instance: Instance) {
		if (hitLimit) return;

		if (instance.IsA("LuaSourceContainer")) {
			// Apply class filter
			if (classFilter) {
				if (!instance.ClassName.lower().find(classFilter.lower())[0]) return;
			}

			scriptsSearched++;
			const source = readScriptSource(instance);
			const [lines] = Utils.splitLines(source);
			const scriptMatches: LineMatch[] = [];
			let scriptMatchCount = 0;

			for (let i = 0; i < lines.size(); i++) {
				if (hitLimit) break;
				if (maxResultsPerScript > 0 && scriptMatchCount >= maxResultsPerScript) break;

				const line = lines[i];
				const searchLine = caseSensitive ? line : line.lower();

				let matchStart: number | undefined;
				let matchEnd: number | undefined;

				if (usePattern) {
					[matchStart, matchEnd] = string.find(searchLine, searchPattern);
				} else {
					[matchStart, matchEnd] = string.find(searchLine, searchPattern, 1, true);
				}

				if (matchStart !== undefined) {
					scriptMatchCount++;
					totalMatches++;

					if (totalMatches > maxResults) {
						hitLimit = true;
						break;
					}

					if (!filesOnly) {
						// Gather context lines
						const before: string[] = [];
						const after: string[] = [];

						if (contextLines > 0) {
							const beforeStart = math.max(0, i - contextLines);
							for (let j = beforeStart; j < i; j++) {
								before.push(lines[j]);
							}
							const afterEnd = math.min(lines.size() - 1, i + contextLines);
							for (let j = i + 1; j <= afterEnd; j++) {
								after.push(lines[j]);
							}
						}

						scriptMatches.push({
							line: i + 1, // 1-indexed
							column: matchStart,
							text: line,
							before,
							after,
						});
					}
				}
			}

			if (scriptMatchCount > 0) {
				const scriptResult: ScriptResult = {
					instancePath: getInstancePath(instance),
					name: instance.Name,
					className: instance.ClassName,
					matches: scriptMatches,
				};
				if (instance.IsA("BaseScript")) {
					scriptResult.enabled = instance.Enabled;
				}
				results.push(scriptResult);
			}
		}

		for (const child of instance.GetChildren()) {
			if (hitLimit) return;
			searchInstance(child);
		}
	}

	searchInstance(startInstance);

	const matched = results.size();
	if (matched === 0) {
		return { results: [], scriptsSearched };
	}
	const resp: Record<string, unknown> = {
		results,
		totalMatches,
		scriptsSearched,
		scriptsMatched: matched,
	};
	if (hitLimit) resp.truncated = true;
	return resp;
}

function getDescendants(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required", errorCode: "missing_arg", argName: "instancePath" };

	const maxDepth = (requestData.maxDepth as number) ?? 10;
	const classFilter = requestData.classFilter as string | undefined;
	const knownHash = requestData.knownHash as string | undefined;

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: "Instance not found", errorCode: "instance_not_found", instancePath, hint: "Use search() or get_project_structure to locate." };

	const descendants: { name: string; className: string; path: string; depth: number }[] = [];

	function collect(inst: Instance, depth: number) {
		if (depth > maxDepth) return;
		for (const child of inst.GetChildren()) {
			if (classFilter && !child.IsA(classFilter as keyof Instances)) continue;
			descendants.push({
				name: child.Name,
				className: child.ClassName,
				path: getInstancePath(child),
				depth,
			});
			collect(child, depth + 1);
		}
	}

	collect(instance, 1);

	const hashParts: Array<string | number | boolean> = ["descendants", instancePath, maxDepth, classFilter ?? "", descendants.size()];
	for (const d of descendants) {
		hashParts.push(d.path);
		hashParts.push(d.className);
	}
	const hash = Hashing.fingerprint(hashParts);
	if (knownHash !== undefined && knownHash === hash) {
		return { unchanged: true, knownHash: hash };
	}

	return { descendants, knownHash: hash };
}

function compareInstances(requestData: Record<string, unknown>) {
	const instancePathA = requestData.instancePathA as string;
	const instancePathB = requestData.instancePathB as string;

	if (!instancePathA || !instancePathB) {
		return { error: "Both instancePathA and instancePathB are required", errorCode: "missing_arg" };
	}

	const instA = getInstanceByPath(instancePathA);
	if (!instA) return { error: "Instance not found", errorCode: "instance_not_found", instancePath: instancePathA, hint: "Use search() or get_project_structure to locate." };

	const instB = getInstanceByPath(instancePathB);
	if (!instB) return { error: "Instance not found", errorCode: "instance_not_found", instancePath: instancePathB, hint: "Use search() or get_project_structure to locate." };

	const commonProps = [
		"Name", "ClassName",
		"Size", "Position", "Rotation", "CFrame", "Anchored", "CanCollide",
		"Transparency", "Material", "Color", "Text", "TextColor3",
		"BackgroundColor3", "Image", "ImageColor3", "Visible", "Active", "ZIndex",
		"BorderSizePixel", "BackgroundTransparency", "ImageTransparency",
		"TextTransparency", "Value", "Enabled", "Brightness", "Range", "Shadows",
	];

	const matching: Record<string, string> = {};
	const differing: Record<string, { a: string; b: string }> = {};
	const onlyA: string[] = [];
	const onlyB: string[] = [];

	for (const prop of commonProps) {
		const [okA, valA] = pcall(() => tostring((instA as unknown as Record<string, unknown>)[prop]));
		const [okB, valB] = pcall(() => tostring((instB as unknown as Record<string, unknown>)[prop]));

		if (okA && okB) {
			if (valA === valB) {
				matching[prop] = valA as string;
			} else {
				differing[prop] = { a: valA as string, b: valB as string };
			}
		} else if (okA) {
			onlyA.push(prop);
		} else if (okB) {
			onlyB.push(prop);
		}
	}

	return {
		instancePathA,
		instancePathB,
		classNameA: instA.ClassName,
		classNameB: instB.ClassName,
		matching,
		differing,
		onlyA,
		onlyB,
	};
}

function getOutputLog(requestData: Record<string, unknown>) {
	const maxEntries = (requestData.maxEntries as number) ?? 100;
	const messageTypeFilter = requestData.messageType as string | undefined;
	const knownHash = requestData.knownHash as string | undefined;

	const [success, result] = pcall(() => {
		const LogService = game.GetService("LogService");
		const history = LogService.GetLogHistory();
		const allEntries: Record<string, unknown>[] = [];

		for (const entry of history) {
			const msgType = tostring(entry.messageType);
			if (messageTypeFilter && msgType !== messageTypeFilter) continue;
			allEntries.push({
				message: entry.message,
				messageType: msgType,
				timestamp: entry.timestamp,
			});
		}

		const startIdx = math.max(0, allEntries.size() - maxEntries);
		const finalEntries: Record<string, unknown>[] = [];
		for (let i = startIdx; i < allEntries.size(); i++) {
			finalEntries.push(allEntries[i]);
		}

		const hashParts: Array<string | number | boolean> = ["output_log", messageTypeFilter ?? "", finalEntries.size()];
		for (const e of finalEntries) {
			hashParts.push(tostring(e.timestamp));
			hashParts.push(tostring(e.messageType));
			hashParts.push(tostring(e.message));
		}
		const hash = Hashing.fingerprint(hashParts);

		if (finalEntries.size() === 0) return { entries: [], knownHash: hash };
		return { entries: finalEntries, count: finalEntries.size(), totalAvailable: allEntries.size(), knownHash: hash };
	});

	if (success) {
		const r = result as Record<string, unknown>;
		if (knownHash !== undefined && knownHash === r.knownHash) {
			return { unchanged: true, knownHash: r.knownHash };
		}
		return r;
	}
	return { error: `Failed to get output log: ${result}`, errorCode: "output_log_failed" };
}

export = {
	getFileTree,
	searchFiles,
	getPlaceInfo,
	getServices,
	searchObjects,
	getInstanceProperties,
	getInstanceChildren,
	searchByProperty,
	getProjectStructure,
	grepScripts,
	getDescendants,
	compareInstances,
	getOutputLog,
};
