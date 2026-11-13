export function createBrowserTestPlugin(): Promise<{
  name: string;
  enforce: "pre";
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
  transform(code: string, id: string): { code: string; map: null } | undefined;
}>;
