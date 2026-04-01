export type RuntimeControl =
  | {
      type: "runtime.start";
      payload: Record<string, never>;
    }
  | {
      type: "runtime.pause";
      payload: Record<string, never>;
    }
  | {
      type: "runtime.step";
      payload: Record<string, never>;
    }
  | {
      type: "runtime.speed.set";
      payload: {
        preset: string;
      };
    }
  | {
      type: "runtime.patch";
      payload: {
        entityId: string;
        patch: Record<string, unknown>;
      };
    }
  | {
      type: "runtime.query.inspect";
      payload: {
        entityId: string;
      };
    };
