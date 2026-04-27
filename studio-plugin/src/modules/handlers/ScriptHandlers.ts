import Utils from "../Utils";
import Recording from "../Recording";
import Hashing from "../Hashing";

const ScriptEditorService = game.GetService("ScriptEditorService");

const { getInstancePath, getInstanceByPath, readScriptSource, splitLines, joinLines } = Utils;
const { beginRecording, finishRecording } = Recording;

function normalizeEscapes(s: string): string {
	let result = s;
	result = result.gsub("\\\\", "\x01")[0];
	result = result.gsub("\\n", "\n")[0];
	result = result.gsub("\\t", "\t")[0];
	result = result.gsub("\\r", "\r")[0];
	result = result.gsub('\\"', '"')[0];
	result = result.gsub("\x01", "\\")[0];
	return result;
}

function getScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number | undefined;
	const endLine = requestData.endLine as number | undefined;
	const knownHash = requestData.knownHash as string | undefined;

	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const fullSource = readScriptSource(instance);
		const hash = Hashing.fingerprint([
			"script-source",
			instancePath,
			fullSource,
			startLine ?? -1,
			endLine ?? -1,
		]);
		if (knownHash !== undefined && knownHash === hash) {
			return { unchanged: true, hash };
		}
		const [lines, hasTrailingNewline] = splitLines(fullSource);
		const totalLineCount = lines.size();

		let sourceToReturn = fullSource;
		let returnedStartLine = 1;
		let returnedEndLine = totalLineCount;

		if (startLine !== undefined || endLine !== undefined) {
			const actualStartLine = math.max(1, startLine ?? 1);
			const actualEndLine = math.min(lines.size(), endLine ?? lines.size());

			const selectedLines: string[] = [];
			for (let i = actualStartLine; i <= actualEndLine; i++) {
				selectedLines.push(lines[i - 1] ?? "");
			}

			sourceToReturn = selectedLines.join("\n");
			if (hasTrailingNewline && actualEndLine === lines.size() && sourceToReturn.sub(-1) !== "\n") {
				sourceToReturn += "\n";
			}
			returnedStartLine = actualStartLine;
			returnedEndLine = actualEndLine;
		}

		const resp: Record<string, unknown> = {
			instancePath,
			className: instance.ClassName,
			name: instance.Name,
			source: sourceToReturn,
			sourceLength: fullSource.size(),
			lineCount: totalLineCount,
			startLine: returnedStartLine,
			endLine: returnedEndLine,
			isPartial: startLine !== undefined || endLine !== undefined,
			truncated: false,
			hash,
		};

		if (startLine === undefined && endLine === undefined && fullSource.size() > 50000) {
			const truncatedLines: string[] = [];
			const maxLines = math.min(1000, lines.size());
			for (let i = 0; i < maxLines; i++) {
				truncatedLines.push(lines[i]);
			}
			resp.source = truncatedLines.join("\n");
			resp.truncated = true;
			resp.endLine = maxLines;
			resp.note = "Script truncated to first 1000 lines. Use startLine/endLine parameters to read specific sections.";
		}

		if (instance.IsA("BaseScript")) {
			resp.enabled = instance.Enabled;
		}

		let topServiceInst: Instance = instance;
		while (topServiceInst.Parent && topServiceInst.Parent !== game) {
			topServiceInst = topServiceInst.Parent;
		}
		resp.topService = topServiceInst.Name;

		return resp;
	});

	if (success) {
		return result;
	} else {
		return { error: `Failed to get script source: ${result}` };
	}
}

interface OutlineFunction {
	name: string;
	line: number;
	endLine: number;
	sig: string;
	kind: string;
}

interface OutlineRequire {
	name: string;
	path: string;
	line: number;
}

interface OutlineLocal {
	name: string;
	line: number;
}

function stripLineComment(line: string): string {
	// Naive: cut at first `--`. Doesn't account for `--` inside strings.
	// Acceptable for outline (false negatives only, not false positives).
	const [pos] = string.find(line, "%-%-", 1, false);
	if (pos !== undefined) return string.sub(line, 1, pos - 1);
	return line;
}

function countMatches(line: string, pattern: string): number {
	let n = 0;
	for (const _ of string.gmatch(line, pattern)) {
		n++;
	}
	return n;
}

function getScriptOutline(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const knownHash = requestData.knownHash as string | undefined;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const source = readScriptSource(instance);
	const hash = Hashing.fingerprint(["script-outline", instancePath, source]);
	if (knownHash !== undefined && knownHash === hash) {
		return { unchanged: true, hash };
	}
	const [lines] = splitLines(source);
	const totalLines = lines.size();

	const functions: OutlineFunction[] = [];
	const requires: OutlineRequire[] = [];
	const topLocals: OutlineLocal[] = [];
	const fnStack: { entry: OutlineFunction; openDepth: number }[] = [];

	let depth = 0;
	let inBlockComment = false;

	for (let i = 0; i < totalLines; i++) {
		const lineNum = i + 1;
		let raw = lines[i];

		// Block comment handling: --[[ ... ]]
		if (inBlockComment) {
			const [closeAt] = string.find(raw, "%]%]", 1, false);
			if (closeAt === undefined) continue;
			raw = string.sub(raw, closeAt + 2);
			inBlockComment = false;
		}
		const [bcOpen] = string.find(raw, "%-%-%[%[", 1, false);
		if (bcOpen !== undefined) {
			const before = string.sub(raw, 1, bcOpen - 1);
			const after = string.sub(raw, bcOpen + 4);
			const [bcClose] = string.find(after, "%]%]", 1, false);
			if (bcClose === undefined) {
				inBlockComment = true;
				raw = before;
			} else {
				raw = before + string.sub(after, bcClose + 2);
			}
		}

		const line = stripLineComment(raw);
		if (string.match(line, "^%s*$")[0] !== undefined) continue;

		// Function declaration: `function NAME(args)` or `local function NAME(args)`.
		// `[%w_:%.]+` covers Foo, Foo.bar, Foo:bar.
		// `%b()` matches the balanced paren group as the args signature.
		const fnMatch = string.find(line, "function%s+([%w_:%.]+)%s*(%b())") as LuaTuple<
			[number?, number?, string?, string?]
		>;
		if (fnMatch[0] !== undefined && fnMatch[2] !== undefined && fnMatch[3] !== undefined) {
			const fnName = fnMatch[2];
			const fnArgs = fnMatch[3];
			const isLocal = string.match(line, "^%s*local%s+function")[0] !== undefined;
			const kind = isLocal
				? "local"
				: string.find(fnName, ":", 1, true)[0] !== undefined
					? "method"
					: "global";
			const entry: OutlineFunction = {
				name: fnName,
				line: lineNum,
				endLine: lineNum,
				sig: `${fnName}${fnArgs}`,
				kind,
			};
			functions.push(entry);
			fnStack.push({ entry, openDepth: depth });
			depth++;
			// Continue depth tracking on the rest of the line.
		} else {
			// Top-level locals (only when not inside a function/block).
			if (depth === 0) {
				const reqMatch = string.find(
					line,
					"^%s*local%s+([%w_]+)%s*=%s*require%s*%(%s*([^%)]*)%s*%)",
				) as LuaTuple<[number?, number?, string?, string?]>;
				if (reqMatch[0] !== undefined && reqMatch[2] !== undefined) {
					requires.push({
						name: reqMatch[2],
						path: reqMatch[3] ?? "",
						line: lineNum,
					});
				} else {
					const locMatch = string.find(line, "^%s*local%s+([%w_]+)%s*=") as LuaTuple<
						[number?, number?, string?]
					>;
					if (locMatch[0] !== undefined && locMatch[2] !== undefined) {
						topLocals.push({ name: locMatch[2], line: lineNum });
					}
				}
			}
		}

		// Track block depth changes from the rest of this line.
		// Frontier patterns require Luau's `%f[%w_]` boundary support.
		const opens =
			countMatches(line, "%f[%w_]do%f[^%w_]") +
			countMatches(line, "%f[%w_]then%f[^%w_]") +
			countMatches(line, "%f[%w_]repeat%f[^%w_]");
		const closes =
			countMatches(line, "%f[%w_]end%f[^%w_]") + countMatches(line, "%f[%w_]until%f[^%w_]");

		// `function` opening was already counted on the function-decl branch above.
		// For inline `function` keywords (anonymous), each one opens a block too.
		const inlineFns =
			countMatches(line, "%f[%w_]function%f[^%w_]") - (fnMatch[0] !== undefined ? 1 : 0);
		const totalOpens = opens + math.max(0, inlineFns);

		depth += totalOpens - closes;
		if (depth < 0) depth = 0;

		// Close any function whose openDepth >= current depth.
		while (fnStack.size() > 0) {
			const top = fnStack[fnStack.size() - 1];
			if (depth <= top.openDepth) {
				top.entry.endLine = lineNum;
				fnStack.pop();
			} else {
				break;
			}
		}
	}

	// Any function still open at EOF — close it at the last line.
	for (const item of fnStack) {
		item.entry.endLine = totalLines;
	}

	return {
		instancePath,
		className: instance.ClassName,
		lineCount: totalLines,
		functions,
		requires,
		topLocals: topLocals.size() > 30 ? [...topLocals].filter((_, i) => i < 30) : topLocals,
		hash,
	};
}

function setScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newSource = requestData.source as string;

	if (!instancePath || !newSource) return { error: "Instance path and source are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const sourceToSet = normalizeEscapes(newSource);
	const recordingId = beginRecording(`Set script source: ${instance.Name}`);

	const [updateSuccess, updateResult] = pcall(() => {
		const oldSourceLength = readScriptSource(instance).size();

		ScriptEditorService.UpdateSourceAsync(instance, () => sourceToSet);

		return {
			success: true, instancePath,
			oldSourceLength, newSourceLength: sourceToSet.size(),
			method: "UpdateSourceAsync",
			message: "Script source updated successfully (editor-safe)",
		};
	});

	if (updateSuccess) {
		finishRecording(recordingId, true);
		return updateResult;
	}

	const [directSuccess, directResult] = pcall(() => {
		const oldSource = (instance as unknown as { Source: string }).Source;
		(instance as unknown as { Source: string }).Source = sourceToSet;

		return {
			success: true, instancePath,
			oldSourceLength: oldSource.size(), newSourceLength: sourceToSet.size(),
			method: "direct",
			message: "Script source updated successfully (direct assignment)",
		};
	});

	if (directSuccess) {
		finishRecording(recordingId, true);
		return directResult;
	}

	const [replaceSuccess, replaceResult] = pcall(() => {
		const parent = instance.Parent;
		const name = instance.Name;
		const className = instance.ClassName;
		const wasBaseScript = instance.IsA("BaseScript");
		const enabled = wasBaseScript ? instance.Enabled : undefined;

		const newScript = new Instance(className as keyof CreatableInstances) as LuaSourceContainer;
		newScript.Name = name;
		(newScript as unknown as { Source: string }).Source = sourceToSet;
		if (wasBaseScript && enabled !== undefined) {
			(newScript as BaseScript).Enabled = enabled;
		}

		newScript.Parent = parent;
		instance.Destroy();

		return {
			success: true,
			instancePath: getInstancePath(newScript),
			method: "replace",
			message: "Script replaced successfully with new source",
		};
	});

	if (replaceSuccess) {
		finishRecording(recordingId, true);
		return replaceResult;
	}

	finishRecording(recordingId, false);
	return {
		error: `Failed to set script source. UpdateSourceAsync failed: ${updateResult}. Direct assignment failed: ${directResult}. Replace method failed: ${replaceResult}`,
	};
}

function editScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	let oldString = requestData.old_string as string;
	let newString = requestData.new_string as string;

	if (!instancePath || oldString === undefined || newString === undefined) {
		return { error: "Instance path, old_string, and new_string are required" };
	}

	oldString = normalizeEscapes(oldString);
	newString = normalizeEscapes(newString);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Edit script: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const source = readScriptSource(instance);

		// Count occurrences to ensure uniqueness
		let count = 0;
		let searchPos = 1;
		const searchLen = oldString.size();

		while (true) {
			const [foundStart] = string.find(source, oldString, searchPos, true);
			if (foundStart === undefined) break;
			count++;
			if (count > 1) break;
			searchPos = foundStart + searchLen;
		}

		if (count === 0) error("old_string not found in script");
		if (count > 1) error("old_string matches multiple locations. Provide more surrounding context to make it unique");

		// Perform the replacement (plain literal find + replace)
		const escaped = escapeLuaPattern(oldString);
		const escapedRepl = escapeLuaReplacement(newString);
		const [newSource] = string.gsub(source, escaped, escapedRepl, 1);

		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true,
			instancePath,
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to edit script: ${result}` };
}

function insertScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const afterLine = (requestData.afterLine as number) ?? 0;
	let newContent = requestData.newContent as string;

	if (!instancePath || !newContent) return { error: "Instance path and newContent are required" };

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Insert script lines after line ${afterLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (afterLine < 0 || afterLine > totalLines) error(`afterLine out of range (0-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < afterLine; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = afterLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			insertedAfterLine: afterLine,
			linesInserted: newLines.size(),
			newLineCount: resultLines.size(),
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to insert script lines: ${result}` };
}

function deleteScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;

	if (!instancePath || !startLine || !endLine) {
		return { error: "Instance path, startLine, and endLine are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Delete script lines ${startLine}-${endLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const resultLines: string[] = [];
		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			deletedLines: { startLine, endLine },
			linesDeleted: endLine - startLine + 1,
			newLineCount: resultLines.size(),
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to delete script lines: ${result}` };
}

function escapeLuaPattern(s: string): string {
	return s.gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")[0];
}

function escapeLuaReplacement(s: string): string {
	return s.gsub("%%", "%%%%")[0];
}

function caseInsensitiveLiteralReplace(src: string, searchStr: string, repl: string): [string, number] {
	const lowerSrc = src.lower();
	const lowerSearch = searchStr.lower();
	const parts: string[] = [];
	let lastEnd = 1;
	const searchLen = lowerSearch.size();
	let pos = 1;
	let replCount = 0;

	while (true) {
		const [foundStart] = string.find(lowerSrc, lowerSearch, pos, true);
		if (foundStart === undefined) break;
		parts.push(string.sub(src, lastEnd, foundStart - 1));
		parts.push(repl);
		lastEnd = foundStart + searchLen;
		pos = foundStart + searchLen;
		replCount++;
	}
	parts.push(string.sub(src, lastEnd));
	return [parts.join(""), replCount];
}

function findAndReplaceInScripts(requestData: Record<string, unknown>) {
	const searchPattern = requestData.pattern as string;
	const replacement = requestData.replacement as string;

	if (!searchPattern) return { error: "pattern is required" };
	if (replacement === undefined) return { error: "replacement is required" };

	const caseSensitive = (requestData.caseSensitive as boolean) ?? false;
	const usePattern = (requestData.usePattern as boolean) ?? false;
	const searchPath = (requestData.path as string) ?? "";
	const classFilter = requestData.classFilter as string | undefined;
	const dryRun = (requestData.dryRun as boolean) ?? false;
	const maxReplacements = (requestData.maxReplacements as number) ?? 1000;

	if (!caseSensitive && usePattern) {
		return { error: "Case-insensitive Lua pattern replacement is not supported. Use caseSensitive: true with usePattern: true, or use literal matching." };
	}

	const startInstance = searchPath !== "" ? getInstanceByPath(searchPath) : game;
	if (!startInstance) return { error: `Path not found: ${searchPath}` };

	interface ScriptChange {
		instancePath: string;
		name: string;
		className: string;
		replacements: number;
	}

	const changes: ScriptChange[] = [];
	let totalReplacements = 0;
	let scriptsSearched = 0;
	let hitLimit = false;

	const recordingId = dryRun ? undefined : beginRecording("Find and replace in scripts");

	function processInstance(instance: Instance) {
		if (hitLimit) return;

		if (instance.IsA("LuaSourceContainer")) {
			if (classFilter && !instance.ClassName.lower().find(classFilter.lower())[0]) return;

			scriptsSearched++;
			const source = readScriptSource(instance);

			let newSource: string;
			let replCount: number;

			if (usePattern) {
				const [result, count] = string.gsub(source, searchPattern, replacement);
				newSource = result;
				replCount = count;
			} else if (caseSensitive) {
				const escaped = escapeLuaPattern(searchPattern);
				const escapedRepl = escapeLuaReplacement(replacement);
				const [result, count] = string.gsub(source, escaped, escapedRepl);
				newSource = result;
				replCount = count;
			} else {
				[newSource, replCount] = caseInsensitiveLiteralReplace(source, searchPattern, replacement);
			}

			if (replCount > 0) {
				if (totalReplacements + replCount > maxReplacements) {
					hitLimit = true;
					return;
				}
				totalReplacements += replCount;

				if (!dryRun) {
					const [ok] = pcall(() => {
						ScriptEditorService.UpdateSourceAsync(instance, () => newSource);
					});
					if (!ok) {
						(instance as unknown as { Source: string }).Source = newSource;
					}
				}

				changes.push({
					instancePath: getInstancePath(instance),
					name: instance.Name,
					className: instance.ClassName,
					replacements: replCount,
				});
			}
		}

		for (const child of instance.GetChildren()) {
			if (hitLimit) return;
			processInstance(child);
		}
	}

	processInstance(startInstance);

	if (recordingId !== undefined) {
		finishRecording(recordingId, changes.size() > 0);
	}

	return {
		success: true,
		dryRun,
		pattern: searchPattern,
		replacement,
		totalReplacements,
		scriptsSearched,
		scriptsModified: changes.size(),
		changes,
		truncated: hitLimit,
	};
}

function getScriptAnalysis(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const results: Record<string, unknown>[] = [];

	function analyzeScript(scriptInstance: Instance) {
		if (!scriptInstance.IsA("LuaSourceContainer")) return;
		const source = readScriptSource(scriptInstance);
		const diagnostics: Record<string, unknown>[] = [];

		const [fn, compileError] = loadstring(source);
		if (!fn && compileError) {
			const [lineStr] = tostring(compileError).match(":(%d+):");
			diagnostics.push({
				line: lineStr ? tonumber(lineStr) : undefined,
				message: tostring(compileError),
				severity: "error",
			});
		}

		results.push({
			scriptPath: getInstancePath(scriptInstance),
			scriptName: scriptInstance.Name,
			diagnostics,
			hasErrors: diagnostics.size() > 0,
		});
	}

	if (instance.IsA("LuaSourceContainer")) {
		analyzeScript(instance);
	} else {
		for (const desc of instance.GetDescendants()) {
			analyzeScript(desc);
		}
	}

	return {
		results,
		totalScripts: results.size(),
		scriptsWithErrors: results.filter(r => (r as { hasErrors: boolean }).hasErrors).size(),
	};
}

export = {
	getScriptSource,
	getScriptOutline,
	setScriptSource,
	editScriptLines,
	insertScriptLines,
	deleteScriptLines,
	findAndReplaceInScripts,
	getScriptAnalysis,
};
