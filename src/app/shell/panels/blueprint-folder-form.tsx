interface BlueprintFolderFormProps {
  readonly translate: (key: string) => string;
  readonly value: string;
  readonly errorMessage: string | null;
  readonly isCreatingFolder: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void | Promise<void>;
  readonly onCancel: () => void;
}

export function BlueprintFolderForm({
  translate,
  value,
  errorMessage,
  isCreatingFolder,
  onValueChange,
  onSubmit,
  onCancel,
}: BlueprintFolderFormProps) {
  return (
    <form
      className="save-blueprint-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <div className="save-blueprint-form-content">
        <label className="save-blueprint-field">
          <span className="save-blueprint-label">{translate("workbench.blueprint.createFolder")}</span>
          <input
            autoFocus
            className="save-blueprint-input"
            data-blueprint-folder-input
            disabled={isCreatingFolder}
            onChange={(event) => {
              onValueChange(event.currentTarget.value);
            }}
            placeholder={translate("workbench.blueprint.createFolderPlaceholder")}
            type="text"
            value={value}
          />
        </label>
        {errorMessage === null ? null : (
          <p className="save-blueprint-error" role="alert">{errorMessage}</p>
        )}
      </div>
      <div className="save-blueprint-actions">
        <button
          className="save-blueprint-secondary-button"
          data-ui-button-id="blueprint-folder-create-cancel"
          disabled={isCreatingFolder}
          onClick={onCancel}
          type="button"
        >
          {translate("workbench.blueprint.cancel")}
        </button>
        <button
          className="save-blueprint-primary-button"
          data-ui-button-id="blueprint-folder-create-submit"
          disabled={isCreatingFolder}
          type="submit"
        >
          {translate("workbench.blueprint.createFolderSubmit")}
        </button>
      </div>
    </form>
  );
}