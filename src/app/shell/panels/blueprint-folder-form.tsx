interface BlueprintFolderFormProps {
  readonly translate: (key: string) => string;
  readonly value: string;
  readonly isCreatingFolder: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void | Promise<void>;
  readonly onCancel: () => void;
}

export function BlueprintFolderForm({
  translate,
  value,
  isCreatingFolder,
  onValueChange,
  onSubmit,
  onCancel,
}: BlueprintFolderFormProps) {
  return (
    <form
      className="blueprint-folder-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <input
        className="blueprint-folder-input"
        data-blueprint-folder-input
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
        placeholder={translate("workbench.blueprint.createFolderPlaceholder")}
        type="text"
        value={value}
      />
      <button
        className="blueprint-utility-button"
        data-ui-button-id="blueprint-folder-create-submit"
        disabled={isCreatingFolder}
        type="submit"
      >
        {translate("workbench.blueprint.createFolderSubmit")}
      </button>
      <button
        className="blueprint-utility-button is-secondary"
        data-ui-button-id="blueprint-folder-create-cancel"
        onClick={onCancel}
        type="button"
      >
        {translate("workbench.blueprint.cancel")}
      </button>
    </form>
  );
}