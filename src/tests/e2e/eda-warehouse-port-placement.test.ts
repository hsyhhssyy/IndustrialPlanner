import { expect, test, SCREEN_PROFILES } from "./harness/fixture";
import separator from "../blueprint-planner/fixtures/separator-core.json" with { type: "json" };

// 三屏开发验证后独立编写；原生选项交互与请求状态同时验证。
for (const profile of SCREEN_PROFILES) {
  test(`取货口规则默认值、单面联动与非法固体供料 [${profile.name}]`, async ({ baseURL, browserSession }) => {
    test.setTimeout(120000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.addInitScript(() => {
        const settings = JSON.parse(localStorage.getItem('v3-user-settings-dialog') || '{}');
        settings.values = {...settings.values, 'other-experimental-features': true};
        localStorage.setItem('v3-user-settings-dialog', JSON.stringify(settings));
      });
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.blueprintPlanner != null);
      await page.evaluate(plan => {
        const controller = window.__industrialPlannerAppHost.blueprintPlannerDialog;
        controller.setEnabled(true); controller.open(plan);
      }, ${JSON.stringify(separator.request.plan)});
      const dialog = page.getByRole('dialog').filter({has:page.locator('#blueprint-planner-title')});
      const rule = dialog.getByRole('combobox',{name:'取货口摆放规则',exact:true});
      const bus = dialog.getByRole('combobox',{name:'存取线形态',exact:true});
      const initial = await rule.inputValue();
      await bus.selectOption('corner'); await rule.selectOption('full-side');
      const linked = {value:await bus.inputValue(),disabled:await bus.isDisabled()};
      const supply = dialog.locator('select').filter({has:page.locator('option[value="external"]')}).first();
      await supply.selectOption('external');
      const invalid = {marked:await supply.getAttribute('aria-invalid'),disabled:await dialog.getByRole('button',{name:'开始规划',exact:true}).isDisabled(),
        red:await supply.evaluate(element => {
          const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; element.parentElement.append(probe);
          const color = getComputedStyle(probe).color; probe.remove();
          return getComputedStyle(element).color === color && getComputedStyle(element).borderTopColor === color;
        })};
      const request = await page.evaluate(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.getRequest());
      await supply.selectOption('warehouse');
      const corrected = !await dialog.getByRole('button',{name:'开始规划',exact:true}).isDisabled();
      await rule.selectOption('continuous');
      return {initial,linked,invalid,request,corrected,unlocked:!await bus.isDisabled()};
    }`) as { initial: string; linked: { value: string; disabled: boolean }; invalid: { marked: string; disabled: boolean; red: boolean };
      request: { options: { warehousePortPlacement: string; warehouseBus: string; itemPolicies: { supply?: string }[] } }; corrected: boolean; unlocked: boolean };
    expect(result.initial).toBe("continuous");
    expect(result.linked).toEqual({ value: "straight", disabled: true });
    expect(result.invalid).toEqual({ marked: "true", disabled: true, red: true });
    expect(result.request.options).toMatchObject({ warehousePortPlacement: "full-side", warehouseBus: "straight" });
    expect(result.request.options.itemPolicies.some(policy => policy.supply === "external")).toBe(true);
    expect(result.corrected).toBe(true);
    expect(result.unlocked).toBe(true);
  });
}
