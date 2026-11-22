export interface CustomRegistryContract {
  getState(): {
    readonly enabled: boolean;
    readonly url: string;
    readonly activeUrl: string | null;
    readonly loading: boolean;
    readonly applying: boolean;
    readonly error: { readonly url: string; readonly message: string } | null;
  };
  setEnabled(enabled: boolean): Promise<void>;
  submitUrl(url: string): Promise<void>;
  refresh(): Promise<void>;
}
