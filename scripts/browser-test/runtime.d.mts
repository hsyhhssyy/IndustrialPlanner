import type { ChildProcess } from "node:child_process";
export function browserProcesses(): Promise<{ pid: number; parent: number; group: number; started: string; args: string }[]>;
export function assertBrowserIdle(allowedPids?: number[]): Promise<void>;
export function browserLeasePath(resource?: "local" | "windows"): string;
export function acquireBrowserLease(label: string, options?: { resource?: "local" | "windows" }): Promise<() => Promise<void>>;
export function portIsOpen(port: number): Promise<boolean>;
export function cliResult(output: string): string;
export function parseCliResult(output: string): unknown;
export class BrowserRound {
  constructor(directory: string);
  readonly directory: string;
  readonly ports: Set<number>;
  readonly stopping: boolean;
  start(executable: string, args: string[], log: string, env?: Record<string, string>): Promise<ChildProcess>;
  command(executable: string, args: string[], log: string, timeoutMs?: number): Promise<string>;
  waitForServer(child: ChildProcess, url: string, timeoutMs?: number): Promise<void>;
  openCli(name: string, config: object): Promise<string>;
  recordNativeBrowser(): Promise<void>;
  close(): Promise<void>;
}
