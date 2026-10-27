const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

// Noms en double suffixés : un zip à deux entrées identiques s'extrait mal.
export function uniqueNames(names: string[]): string[] {
	const seen = new Set<string>();
	return names.map((name) => {
		let candidate = name;
		for (let n = 2; seen.has(candidate.toLowerCase()); n++) {
			const dot = name.lastIndexOf('.');
			candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
		}
		seen.add(candidate.toLowerCase());
		return candidate;
	});
}

// Méthode « stockée » sans compression, noms UTF-8 (bit 11).
export function zipStore(files: Array<{ name: string; data: Uint8Array }>, date = new Date()): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const year = Math.max(date.getUTCFullYear(), 1980);
	const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
	const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		const crc = crc32(file.data);
		const size = file.data.byteLength;
		const local = new Uint8Array(30 + name.length);
		const l = new DataView(local.buffer);
		l.setUint32(0, 0x04034b50, true);
		l.setUint16(4, 20, true);
		l.setUint16(6, 0x0800, true);
		l.setUint16(10, time, true);
		l.setUint16(12, day, true);
		l.setUint32(14, crc, true);
		l.setUint32(18, size, true);
		l.setUint32(22, size, true);
		l.setUint16(26, name.length, true);
		local.set(name, 30);
		const entry = new Uint8Array(46 + name.length);
		const e = new DataView(entry.buffer);
		e.setUint32(0, 0x02014b50, true);
		e.setUint16(4, 20, true);
		e.setUint16(6, 20, true);
		e.setUint16(8, 0x0800, true);
		e.setUint16(12, time, true);
		e.setUint16(14, day, true);
		e.setUint32(16, crc, true);
		e.setUint32(20, size, true);
		e.setUint32(24, size, true);
		e.setUint16(28, name.length, true);
		e.setUint32(42, offset, true);
		entry.set(name, 46);
		chunks.push(local, file.data);
		central.push(entry);
		offset += local.length + size;
	}
	const centralSize = central.reduce((n, entry) => n + entry.length, 0);
	const end = new Uint8Array(22);
	const d = new DataView(end.buffer);
	d.setUint32(0, 0x06054b50, true);
	d.setUint16(8, files.length, true);
	d.setUint16(10, files.length, true);
	d.setUint32(12, centralSize, true);
	d.setUint32(16, offset, true);
	const out = new Uint8Array(offset + centralSize + end.length);
	let at = 0;
	for (const chunk of [...chunks, ...central, end]) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}
