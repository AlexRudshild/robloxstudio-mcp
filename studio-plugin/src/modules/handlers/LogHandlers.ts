import RuntimeLogBuffer from "../RuntimeLogBuffer";

function getRuntimeLogs(requestData: Record<string, unknown>): unknown {
	const since = requestData.since as number | undefined;
	const tail = requestData.tail as number | undefined;
	const filter = requestData.filter as string | undefined;
	// capturedBy is the DM whose plugin buffer observed the log ("edit", or
	// "server" during in-place Run), not necessarily the script-origin peer.
	const capturedBy = RuntimeLogBuffer.detectPeer();
	return RuntimeLogBuffer.query({ since, tail, filter }, capturedBy);
}

export = { getRuntimeLogs };
