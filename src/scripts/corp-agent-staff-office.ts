import type { NS } from "../NetscriptDefinitions";
import type { StaffingTask } from "../lib/corp-constants";
import { DIVISION_NAME } from "../lib/corp-constants";

// Arg-driven: ns.args[0] is a JSON-encoded StaffingTask[] - exactly which roles are missing per
// city, computed by corp-manager.ts from the latest corp-offices.json report. hireEmployee's
// position argument places the new hire directly into that role - no separate
// setJobAssignment call needed.
export async function main(ns: NS): Promise<void> {
	const tasks = JSON.parse(ns.args[0] as string) as StaffingTask[];
	for (const task of tasks) {
		for (const role of task.roles) {
			const hired = ns.corporation.hireEmployee(DIVISION_NAME, task.city, role);
			if (hired) {
				ns.tprint(`hired ${role} in ${task.city}`);
			} else {
				ns.print(`corp-agent-staff-office: hireEmployee(${task.city}, ${role}) returned false (office full or no applicants?)`);
			}
		}
	}
}
