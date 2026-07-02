// In-memory ring buffer for LogService.MessageOut, powering get_runtime_logs.
//
// Installed once in the edit DM at plugin load; captured entries live in plugin
// module-state (nothing parented to the DataModel). During in-place Run mode
// the edit DM IS the running server, so this keeps capturing runtime output;
// during Play mode (a separate DataModel) only whatever LogService reflects
// into the edit DM is seen — this edit-only buffer does not register a peer in
// the play DMs, so separate play-server/client logs are not guaranteed.
//
// The buffer is bounded by a byte budget; oldest entries drop when over budget.
// query() supports since-cursor incremental polling, a tail cap, and a plain
// substring filter.

import { LogService, RunService } from "@rbxts/services";

type LogLevel = "OUT" | "WARN" | "ERR" | "INFO";

interface RuntimeLogEntry {
	seq: number;
	ts: number; // wall-clock seconds
	level: LogLevel;
	message: string;
}

const MAX_BYTES = 64 * 1024;
const HARD_ENTRY_CAP = 50_000;

const entries: RuntimeLogEntry[] = [];
let totalBytes = 0;
let totalDropped = 0;
let nextSeq = 1;
let installed = false;

function levelTag(t: Enum.MessageType): LogLevel {
	if (t === Enum.MessageType.MessageWarning) return "WARN";
	if (t === Enum.MessageType.MessageError) return "ERR";
	if (t === Enum.MessageType.MessageInfo) return "INFO";
	return "OUT";
}

function nowSec(): number {
	return DateTime.now().UnixTimestampMillis / 1000;
}

function dropOldestUntilFits(incomingBytes: number): void {
	while (
		entries.size() > 0 &&
		(totalBytes + incomingBytes > MAX_BYTES || entries.size() >= HARD_ENTRY_CAP)
	) {
		const dropped = entries.shift()!;
		totalBytes -= dropped.message.size();
		totalDropped += 1;
	}
}

function pushEntry(msg: string, t: Enum.MessageType, ts = nowSec()): void {
	const bytes = msg.size();
	dropOldestUntilFits(bytes);
	entries.push({
		seq: nextSeq,
		ts,
		level: levelTag(t),
		message: msg,
	});
	nextSeq += 1;
	totalBytes += bytes;
}

interface LogHistoryEntry {
	message: string;
	messageType: Enum.MessageType;
	timestamp: number;
}

function seedRuntimeHistory(): void {
	if (!RunService.IsRunning()) return;

	const [ok, history] = pcall(() => LogService.GetLogHistory() as LogHistoryEntry[]);
	if (!ok) return;

	for (const entry of history) {
		if (!typeIs(entry.message, "string")) continue;
		pushEntry(entry.message, entry.messageType, typeIs(entry.timestamp, "number") ? entry.timestamp : undefined);
	}
}

function install(): void {
	if (installed) return;
	if (!RunService.IsStudio()) return;
	installed = true;
	// Seed from GetLogHistory only when already running, so a fresh edit-DM
	// install doesn't pull stale logs from a prior session.
	seedRuntimeHistory();
	LogService.MessageOut.Connect((msg, t) => {
		pushEntry(msg, t);
	});
}

function detectPeer(): "edit" | "server" | "client" {
	if (!RunService.IsRunning()) return "edit";
	if (RunService.IsServer()) return "server";
	return "client";
}

interface QueryOptions {
	since?: number;
	tail?: number;
	filter?: string; // Plain substring match, applied to message
}

interface QueryResult {
	capturedBy: string;
	entries: RuntimeLogEntry[];
	totalDropped: number;
	nextSince: number;
	tailOmitted?: number;
}

function query(opts: QueryOptions, capturedBy: string): QueryResult {
	let result = opts.since !== undefined
		? entries.filter((e) => e.seq > (opts.since as number))
		: [...entries];

	if (opts.filter !== undefined) {
		// Plain substring search (4th arg = true): Lua magic chars in messages
		// would otherwise silently not match (e.g. "MARK-EDIT" vs "MARK-EDIT-001"
		// where '-' means "0+" in a Lua pattern).
		const needle = opts.filter;
		result = result.filter((e) => {
			const [start] = string.find(e.message, needle, 1, true);
			return start !== undefined;
		});
	}

	// tail keeps the newest N. When combined with since, that means entries
	// between `since` and the tail window are dropped from THIS response and,
	// because nextSince advances to the buffer tail, they are never returned by
	// a later incremental poll. Report the count so the drop isn't silent —
	// callers who need every entry should poll with `since` and no `tail`.
	let tailOmitted = 0;
	if (opts.tail !== undefined && result.size() > opts.tail) {
		tailOmitted = result.size() - opts.tail;
		// roblox-ts arrays don't expose .slice; manual tail copy.
		const tailed: RuntimeLogEntry[] = [];
		const start = result.size() - opts.tail;
		for (let i = start; i < result.size(); i++) {
			tailed.push(result[i]);
		}
		result = tailed;
	}

	const last = entries.size() > 0 ? entries[entries.size() - 1] : undefined;
	const out: QueryResult = {
		capturedBy,
		entries: result,
		totalDropped,
		nextSince: last ? last.seq : (opts.since ?? 0),
	};
	if (tailOmitted > 0) out.tailOmitted = tailOmitted;
	return out;
}

export = {
	install,
	detectPeer,
	query,
};
