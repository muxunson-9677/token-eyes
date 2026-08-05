const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "dashboard", "src");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("basic settings sections use the approved semantic icon tones", () => {
  const expectations = [
    ["components/settings/AppearanceSection.jsx", 'icon={Monitor}', 'iconTone="blue"'],
    ["components/settings/MenuBarSection.jsx", 'icon={Activity}', 'iconTone="violet"'],
    ["components/settings/DataDirectoriesSection.jsx", 'icon={FolderOpen}', 'iconTone="green"'],
    ["components/settings/AgentPricingSection.jsx", 'icon={DollarSign}', 'iconTone="orange"'],
    ["pages/SettingsPage.jsx", 'icon={Gauge}', 'iconTone="green"'],
  ];

  for (const [file, icon, tone] of expectations) {
    const source = read(file);
    assert.ok(source.includes(icon), `${file} should render ${icon}`);
    assert.ok(source.includes(tone), `${file} should render ${tone}`);
  }
});

test("cost settings sections use the approved semantic icon tones", () => {
  const expectations = [
    ["components/settings/TokenPlanSection.jsx", 'icon={Package}', 'iconTone="violet"'],
    ["components/settings/OtherAiSpendSection.jsx", 'icon={Sparkles}', 'iconTone="rose"'],
  ];

  for (const [file, icon, tone] of expectations) {
    const source = read(file);
    assert.ok(source.includes(icon), `${file} should render ${icon}`);
    assert.ok(source.includes(tone), `${file} should render ${tone}`);
  }

  const providerApi = read("components/settings/ProviderApiConfigSection.jsx");
  assert.ok(providerApi.includes('icon={PlugZap}'));
  assert.ok(providerApi.includes('iconTone="blue"'));
  assert.ok(providerApi.includes('iconTestId="provider-api-section-icon"'));
});
