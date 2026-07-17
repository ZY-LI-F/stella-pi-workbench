import { Sparkles } from "lucide-react";
import { skinDefinition, type SkinPreference } from "../lib/skins";

interface BrandProps {
  readonly compact?: boolean;
  readonly skin?: SkinPreference;
}

export function Brand({ compact = false, skin = "stella" }: BrandProps) {
  const definition = skinDefinition(skin);
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label={`Stella Pi Workbench · ${definition.label}皮肤`}>
      <div className="brand__mark" aria-hidden="true">
        <Sparkles size={15} strokeWidth={1.8} />
        <span className="brand__orbit" />
      </div>
      <div className="brand__type">
        <span className="brand__signature">Stella</span>
        {!compact && <span className="brand__caption">PI WORKBENCH <i>· {definition.label}</i></span>}
      </div>
    </div>
  );
}
