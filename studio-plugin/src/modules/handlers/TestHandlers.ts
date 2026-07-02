import { HttpService, LogService, RunService } from "@rbxts/services";
import StopPlayMonitor from "../StopPlayMonitor";

const StudioTestService = game.GetService("StudioTestService");
const ServerScriptService = game.GetService("ServerScriptService");
const ScriptEditorService = game.GetService("ScriptEditorService");

const NAV_SIGNAL = "__MCP_NAV__";
const NAV_RESULT = "__MCP_NAV_RESULT__";

interface OutputEntry {
	message: string;
	messageType: string;
	timestamp: number;
}

let testRunning = false;
let outputBuffer: OutputEntry[] = [];
let logConnection: RBXScriptConnection | undefined;
let testResult: unknown;
let testError: string | undefined;
let stopListenerScript: Script | undefined;
let navResultCallback: ((json: string) => void) | undefined;

function buildCommandListenerSource(): string {
	return `local LogService = game:GetService("LogService")
local PathfindingService = game:GetService("PathfindingService")
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local NAV_SIG = "${NAV_SIGNAL}"
local NAV_RES = "${NAV_RESULT}"
-- Mirror of Utils.getInstanceByPath: parse canonical paths that may contain
-- bracket-quoted segments (game.X["a.b"]) and GetService roots, so nav resolves
-- the same paths every other tool now emits.
local function parsePath(path)
	local i, len, parts, current = 1, #path, {}, ""
	if path == "" or path == "game" then return parts end
	if string.sub(path, 1, 5) == "game." then i = 6
	elseif string.sub(path, 1, 5) == "game[" then i = 5 end
	while i <= len do
		local ch = string.sub(path, i, i)
		if ch == "." then
			if current ~= "" then table.insert(parts, current); current = ""; i = i + 1
			elseif i > 1 and string.sub(path, i-1, i-1) == "." and i < len and string.sub(path, i+1, i+1) ~= "[" then
				current = "."; i = i + 1
			else i = i + 1 end
		elseif ch == "[" and i < len and (string.sub(path, i+1, i+1) == '"' or string.sub(path, i+1, i+1) == "'") and string.sub(path, i-1, i-1) ~= "." then
			if current ~= "" then table.insert(parts, current); current = "" end
			local quote = string.sub(path, i+1, i+1)
			local j, raw = i + 2, ""
			while j <= len do
				local c = string.sub(path, j, j)
				if c == "\\\\" then
					if j >= len then return nil end
					local nx = string.sub(path, j+1, j+1)
					if nx == "n" then raw = raw .. "\\n"
					elseif nx == "r" then raw = raw .. "\\r"
					elseif nx == "t" then raw = raw .. "\\t"
					else raw = raw .. nx end
					j = j + 2
				elseif c == quote then break
				else raw = raw .. c; j = j + 1 end
			end
			if j > len or string.sub(path, j, j) ~= quote or string.sub(path, j+1, j+1) ~= "]" then return nil end
			table.insert(parts, raw); i = j + 2
		else current = current .. ch; i = i + 1 end
	end
	if current ~= "" then table.insert(parts, current) end
	return parts
end
local function resolvePath(path)
	local parts = parsePath(path)
	if not parts then return nil end
	if #parts == 0 then return game end
	local ok, svc = pcall(function() return game:GetService(parts[1]) end)
	local cur = (ok and svc) or game:FindFirstChild(parts[1])
	for idx = 2, #parts do
		if not cur then return nil end
		cur = cur:FindFirstChild(parts[idx])
	end
	return cur
end
LogService.MessageOut:Connect(function(msg)
	if string.sub(msg, 1, #NAV_SIG + 1) == NAV_SIG .. ":" then
		local json = string.sub(msg, #NAV_SIG + 2)
		task.spawn(function()
			local ok, d = pcall(function() return HttpService:JSONDecode(json) end)
			if not ok or not d then
				print(NAV_RES .. ':{"success":false,"error":"parse_error"}')
				return
			end
			local ps = Players:GetPlayers()
			if #ps == 0 then
				print(NAV_RES .. ':{"success":false,"error":"no_players"}')
				return
			end
			local char = ps[1].Character or ps[1].CharacterAdded:Wait()
			local hum = char:FindFirstChildOfClass("Humanoid")
			local root = char:FindFirstChild("HumanoidRootPart")
			if not hum or not root then
				print(NAV_RES .. ':{"success":false,"error":"no_humanoid"}')
				return
			end
			local target
			if d.instancePath then
				local cur = resolvePath(d.instancePath)
				if not cur then
					print(NAV_RES .. ':{"success":false,"error":"instance_not_found"}')
					return
				end
				if cur:IsA("BasePart") then target = cur.Position
				elseif cur:IsA("Model") and cur.PrimaryPart then target = cur.PrimaryPart.Position
				else target = cur:GetPivot().Position end
			else
				target = Vector3.new(d.x or 0, d.y or 0, d.z or 0)
			end
			local path = PathfindingService:CreatePath({AgentRadius=2,AgentHeight=5,AgentCanJump=true})
			local pok = pcall(function() path:ComputeAsync(root.Position, target) end)
			local method = "direct"
			if pok and path.Status == Enum.PathStatus.Success then
				method = "pathfinding"
				for _, wp in ipairs(path:GetWaypoints()) do
					hum:MoveTo(wp.Position)
					if wp.Action == Enum.PathWaypointAction.Jump then hum.Jump = true end
					hum.MoveToFinished:Wait()
				end
			else
				hum:MoveTo(target)
				hum.MoveToFinished:Wait()
			end
			local fp = root.Position
			print(NAV_RES .. ':{"success":true,"method":"' .. method .. '","position":[' .. fp.X .. ',' .. fp.Y .. ',' .. fp.Z .. ']}')
		end)
	end
end)`;
}

function injectStopListener() {
	const listener = new Instance("Script");
	listener.Name = "__MCP_CommandListener";
	listener.Parent = ServerScriptService;

	const source = buildCommandListenerSource();
	const [seOk] = pcall(() => {
		ScriptEditorService.UpdateSourceAsync(listener, () => source);
	});
	if (!seOk) {
		(listener as unknown as { Source: string }).Source = source;
	}

	stopListenerScript = listener;
}

function cleanupStopListener() {
	if (stopListenerScript) {
		pcall(() => stopListenerScript!.Destroy());
		stopListenerScript = undefined;
	}
}

function startPlaytest(requestData: Record<string, unknown>) {
	const mode = requestData.mode as string | undefined;
	const numPlayers = requestData.numPlayers as number | undefined;

	if (mode !== "play" && mode !== "run") {
		return { error: 'mode must be "play" or "run"', errorCode: "invalid_arg", argName: "mode" };
	}

	if (testRunning) {
		return { error: "A test is already running", errorCode: "test_in_progress", retryable: false };
	}

	testRunning = true;
	outputBuffer = [];
	testResult = undefined;
	testError = undefined;

	// Clear any stale stop-request token (e.g. from a defensive stop_playtest
	// that ran while nothing was playing) so the play-server DM's monitor can't
	// immediately EndTest this fresh session.
	StopPlayMonitor.ensurePlaceId();
	StopPlayMonitor.clearPending();

	cleanupStopListener();

	logConnection = LogService.MessageOut.Connect((message, messageType) => {
		if (message.sub(1, NAV_SIGNAL.size()) === NAV_SIGNAL) return;
		if (message.sub(1, NAV_RESULT.size() + 1) === `${NAV_RESULT}:`) {
			if (navResultCallback) {
				navResultCallback(message.sub(NAV_RESULT.size() + 2));
			}
			return;
		}
		outputBuffer.push({
			message,
			messageType: messageType.Name,
			timestamp: tick(),
		});
	});

	const [injected, injErr] = pcall(() => injectStopListener());
	if (!injected) {
		warn(`[MCP] Failed to inject stop listener: ${injErr}`);
	}

	if (numPlayers !== undefined && mode === "run") {
		const TestService = game.GetService("TestService") as TestService & { NumberOfPlayers: number };
		TestService.NumberOfPlayers = math.clamp(numPlayers, 1, 8);
	}

	task.spawn(() => {
		const [ok, result] = pcall(() => {
			if (mode === "play") {
				return StudioTestService.ExecutePlayModeAsync({});
			}
			return StudioTestService.ExecuteRunModeAsync({});
		});

		if (ok) {
			testResult = result;
		} else {
			testError = tostring(result);
		}

		if (logConnection) {
			logConnection.Disconnect();
			logConnection = undefined;
		}
		testRunning = false;

		cleanupStopListener();
	});

	const msg = numPlayers !== undefined
		? `Playtest started in ${mode} mode with ${numPlayers} player(s)`
		: `Playtest started in ${mode} mode`;
	return { success: true, message: msg };
}

function stopPlaytest(_requestData: Record<string, unknown>) {
	// In-place Run mode: this DM IS the running server (plugin loaded while
	// IsEdit was true, so the monitor never started here) — EndTest directly.
	if (RunService.IsRunning() && RunService.IsServer()) {
		const captured = [...outputBuffer];
		const [endOk, endErr] = pcall(() => StudioTestService.EndTest("stopped_by_mcp"));
		if (!endOk) {
			return { error: `StudioTestService.EndTest failed: ${endErr}`, errorCode: "end_test_failed" };
		}
		// Let the run unwind so an immediate start_playtest doesn't race teardown.
		const runStart = tick();
		while (testRunning && tick() - runStart < 10) {
			task.wait(0.25);
		}
		return {
			success: true,
			output: captured,
			outputCount: captured.size(),
			message: "Playtest stopped.",
		};
	}

	// Play mode: the test runs in a separate DataModel. Signal its
	// StopPlayMonitor via the plugin-settings mailbox and wait for the
	// play-server DM to confirm it actually consumed the request —
	// cross-DM warn()/MessageOut does not reach it, and EndTest is
	// illegal from the edit DM.
	const req = StopPlayMonitor.requestStop();
	if (!req.ok || req.requestId === undefined) {
		return { error: "Could not write the stop request to plugin settings.", errorCode: "plugin_not_ready" };
	}
	// Always allow the full timeout: monitor detection is fast but EndTest
	// teardown on a heavy place is the slow part, and the result token is only
	// written after teardown — a shorter wait would falsely report no_test_running
	// for a real (e.g. manually-started) session that is in fact being stopped.
	const result = StopPlayMonitor.waitForConsumption(req.requestId);
	StopPlayMonitor.clearPending(req.requestId);

	if (!result.consumed) {
		if (!testRunning) {
			return { error: "No running playtest acknowledged the stop request.", errorCode: "no_test_running" };
		}
		return {
			error: result.error ?? "Playtest did not acknowledge the stop request.",
			errorCode: "stop_not_confirmed",
			retryable: true,
			output: [...outputBuffer],
			outputCount: outputBuffer.size(),
		};
	}
	if (!result.ok) {
		return { error: result.error ?? "EndTest failed in the play-server DataModel.", errorCode: "end_test_failed" };
	}

	// Confirmed. Wait for ExecutePlayModeAsync to unwind so an immediate
	// start_playtest doesn't race the teardown.
	const start = tick();
	while (testRunning && tick() - start < 10) {
		task.wait(0.25);
	}

	return {
		success: true,
		output: [...outputBuffer],
		outputCount: outputBuffer.size(),
		message: testRunning
			? "Playtest stop confirmed; Studio teardown still in progress."
			: "Playtest stopped.",
	};
}

function getPlaytestOutput(_requestData: Record<string, unknown>) {
	return {
		isRunning: testRunning,
		output: [...outputBuffer],
		outputCount: outputBuffer.size(),
		testResult: testResult !== undefined ? tostring(testResult) : undefined,
		testError,
	};
}

function characterNavigation(requestData: Record<string, unknown>) {
	if (!testRunning) {
		return { error: "Playtest must be running. Start a playtest in 'play' mode first.", errorCode: "no_test_running" };
	}

	const position = requestData.position as number[] | undefined;
	const instancePath = requestData.instancePath as string | undefined;
	const waitForCompletion = (requestData.waitForCompletion as boolean) ?? true;
	const timeout = (requestData.timeout as number) ?? 25;

	if (!position && !instancePath) {
		return { error: "Either position [x, y, z] or instancePath is required", errorCode: "missing_arg" };
	}

	let navData: string;
	if (position) {
		navData = HttpService.JSONEncode({ x: position[0], y: position[1], z: position[2] });
	} else {
		navData = HttpService.JSONEncode({ instancePath });
	}

	warn(`${NAV_SIGNAL}:${navData}`);

	if (!waitForCompletion) {
		return { success: true, message: "Navigation command sent" };
	}

	let result: string | undefined;
	navResultCallback = (json: string) => {
		result = json;
	};

	const startTime = tick();
	while (!result && tick() - startTime < timeout) {
		task.wait(0.2);
	}
	navResultCallback = undefined;

	if (result) {
		const [ok, parsed] = pcall(() => HttpService.JSONDecode(result!));
		if (ok) return parsed;
		return { success: true, rawResult: result };
	}
	return { error: `Navigation timed out after ${timeout} seconds`, errorCode: "timeout", retryable: true };
}

export = {
	startPlaytest,
	stopPlaytest,
	getPlaytestOutput,
	characterNavigation,
};
