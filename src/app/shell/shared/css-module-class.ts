type CssModuleMap = Readonly<Record<string, string | undefined>>;

function shouldExposeLegacyClassNames(): boolean {
  return import.meta.env.MODE === "test";
}

export function cm(
  styles: CssModuleMap,
  ...values: Array<string | false | null | undefined>
): string {
  const classNames: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const className of value.split(/\s+/)) {
      if (className.length === 0) {
        continue;
      }

      const resolvedClassName = styles[className] ?? className;
      classNames.push(resolvedClassName);

      if (shouldExposeLegacyClassNames() && resolvedClassName !== className) {
        classNames.push(className);
      }
    }
  }

  return classNames.join(" ");
}
