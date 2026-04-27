import { HttpService } from "@rbxts/services";

const sessionSalt = HttpService.GenerateGUID(false);

function fnv1a(input: string): string {
	let hash = 2166136261;
	const len = input.size();
	for (let i = 1; i <= len; i++) {
		const [byte] = string.byte(input, i);
		hash = bit32.bxor(hash, byte ?? 0);
		hash = bit32.band(hash * 16777619, 0xffffffff);
	}
	return string.format("%08x", hash);
}

function hashString(input: string): string {
	return fnv1a(`${sessionSalt}\x1f${input}`);
}

function fingerprint(parts: Array<string | number | boolean>): string {
	const buf: string[] = [];
	for (const p of parts) {
		buf.push(tostring(p));
	}
	return hashString(buf.join("\x1f"));
}

export = {
	hashString,
	fingerprint,
	sessionSalt,
};
