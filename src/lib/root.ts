import type { NS } from "../NetscriptDefinitions";

export function tryRoot(ns: NS, host: string): boolean {
	if (ns.hasRootAccess(host)) return true;

	// Each opener is called directly (not through a closure stored in an array/object)
	// so Bitburner's static RAM analyzer can resolve every ns.* call unambiguously.
	// Indirect calls (e.g. invoking a function stored as `opener.run`) can make the
	// analyzer fall back to a worst-case guess - it was attributing a phantom 10GB
	// "codingcontract.attempt" charge to this script when the openers lived in an array.
	//
	// Ports don't close once opened, so re-running every available opener each call
	// (rather than tracking which ones are "new") always leaves openedCount equal to
	// the host's actual open port count - without the 2GB ns.getServer() tax to read it.
	let openedCount = 0;
	if (ns.fileExists("BruteSSH.exe", "home")) {
		ns.brutessh(host);
		openedCount++;
	}
	if (ns.fileExists("FTPCrack.exe", "home")) {
		ns.ftpcrack(host);
		openedCount++;
	}
	if (ns.fileExists("relaySMTP.exe", "home")) {
		ns.relaysmtp(host);
		openedCount++;
	}
	if (ns.fileExists("HTTPWorm.exe", "home")) {
		ns.httpworm(host);
		openedCount++;
	}
	if (ns.fileExists("SQLInject.exe", "home")) {
		ns.sqlinject(host);
		openedCount++;
	}

	if (openedCount < ns.getServerNumPortsRequired(host)) {
		return false;
	}

	ns.nuke(host);
	return ns.hasRootAccess(host);
}
