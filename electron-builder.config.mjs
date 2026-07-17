const APPLE_NOTARIZATION_GROUPS = Object.freeze([
  Object.freeze(["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]),
  Object.freeze(["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]),
  Object.freeze(["APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE"]),
]);

function hasEnvironmentValue(name) {
  return typeof process.env[name] === "string" && process.env[name].trim().length > 0;
}

function notarizationEnabled() {
  const completeGroup = APPLE_NOTARIZATION_GROUPS.find((group) => group.every(hasEnvironmentValue));
  if (completeGroup) return true;

  const supplied = APPLE_NOTARIZATION_GROUPS.flat().filter(hasEnvironmentValue);
  if (supplied.length > 0 || process.env.STELLA_REQUIRE_NOTARIZATION === "1") {
    throw new Error(
      "macOS 公证凭据不完整：请提供 APPLE_API_KEY/API_KEY_ID/API_ISSUER，或 APPLE_ID/APP_SPECIFIC_PASSWORD/TEAM_ID，或 APPLE_KEYCHAIN/PROFILE。",
    );
  }
  return false;
}

const requireSigning = process.env.STELLA_REQUIRE_SIGNING === "1";
const signingConfigured =
  requireSigning ||
  ["CSC_LINK", "CSC_NAME"].some(hasEnvironmentValue);

// electron-builder normalizes the configuration in place, so this boundary object
// must remain mutable even though application state is immutable-first.
export default {
  appId: "dev.stella.piworkbench",
  productName: "Stella Pi Workbench",
  executableName: "Stella Pi Workbench",
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: [
    "out/**/*",
    "!out/**/*.map",
  ],
  asar: true,
  asarUnpack: [
    "node_modules/@earendil-works/**/*",
    "node_modules/@silvia-odwyer/photon-node/**/*",
    "node_modules/@mariozechner/clipboard/**/*",
  ],
  npmRebuild: true,
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  win: {
    icon: "build/icon.svg",
    forceCodeSigning: requireSigning,
    requestedExecutionLevel: "asInvoker",
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Stella Pi Workbench",
    uninstallDisplayName: "Stella Pi Workbench",
    deleteAppDataOnUninstall: false,
  },
  mac: {
    icon: "build/icon.svg",
    category: "public.app-category.developer-tools",
    forceCodeSigning: requireSigning,
    identity: signingConfigured ? undefined : null,
    hardenedRuntime: signingConfigured,
    notarize: notarizationEnabled(),
    target: ["dmg", "zip"],
  },
  dmg: {
    title: "Stella Pi Workbench ${version}",
    iconSize: 112,
    contents: [
      { x: 148, y: 180, type: "file" },
      { x: 392, y: 180, type: "link", path: "/Applications" },
    ],
  },
};
