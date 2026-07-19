import { Check, ExternalLink, ImagePlus, Keyboard, Monitor, Moon, RotateCcw, ShieldCheck, ShieldOff, Sun } from "lucide-react";
import type { RuntimeBootstrap } from "@shared/contracts";
import type { SkinArtworkBySkin, SkinId } from "@shared/skin-artwork";
import type { Preferences, ThemePreference } from "../hooks/use-preferences";
import { SKIN_OPTIONS, skinDefinition } from "../lib/skins";
import { Modal } from "./Modal";

interface SettingsDialogProps {
  readonly bootstrap: RuntimeBootstrap;
  readonly preferences: Preferences;
  readonly customArtwork: SkinArtworkBySkin;
  readonly artworkBusySkin: SkinId | null;
  readonly onPreferencesChange: (preferences: Preferences) => void;
  readonly onChooseSkinArtwork: (skin: SkinId) => void;
  readonly onResetSkinArtwork: (skin: SkinId) => void;
  readonly onAutoCompactionChange: (enabled: boolean) => void;
  readonly onSteeringModeChange: (mode: "all" | "one-at-a-time") => void;
  readonly onFollowUpModeChange: (mode: "all" | "one-at-a-time") => void;
  readonly onRestartTrust: (trusted: boolean) => void;
  readonly onOpenLink: (url: string) => void;
  readonly onClose: () => void;
}

const THEMES: readonly { readonly value: ThemePreference; readonly label: string; readonly icon: typeof Sun }[] = Object.freeze([
  Object.freeze({ value: "light", label: "月白", icon: Sun }),
  Object.freeze({ value: "dark", label: "星夜", icon: Moon }),
  Object.freeze({ value: "system", label: "跟随系统", icon: Monitor }),
]);

function Toggle({ checked, onChange, label }: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly label: string }) {
  return <button type="button" className={`toggle ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

export function SettingsDialog({
  bootstrap,
  preferences,
  customArtwork,
  artworkBusySkin,
  onPreferencesChange,
  onChooseSkinArtwork,
  onResetSkinArtwork,
  onAutoCompactionChange,
  onSteeringModeChange,
  onFollowUpModeChange,
  onRestartTrust,
  onOpenLink,
  onClose,
}: SettingsDialogProps) {
  const selectedSkin = skinDefinition(preferences.skin);
  const selectedArtwork = customArtwork[preferences.skin];
  const artworkBusy = artworkBusySkin === preferences.skin;
  return (
    <Modal title="偏好设置" eyebrow="STELLA SETTINGS" onClose={onClose} className="settings-dialog">
      <div className="settings-scroll">
        <section className="settings-section settings-section--skins">
          <div className="settings-section__heading"><span>皮肤</span><small>选择一套完整的视觉性格</small></div>
          <div className="skin-options" role="radiogroup" aria-label="界面皮肤">
            {SKIN_OPTIONS.map((skin) => {
              const selected = preferences.skin === skin.value;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`skin-option skin-option--${skin.value} ${selected ? "is-active" : ""}`}
                  key={skin.value}
                  onClick={() => onPreferencesChange(Object.freeze({ ...preferences, skin: skin.value }))}
                >
                  <span className="skin-option__preview" aria-hidden="true">
                    {customArtwork[skin.value] && <img src={customArtwork[skin.value]?.url} alt="" />}
                    <i /><b />
                  </span>
                  <span className="skin-option__copy">
                    <span><strong>{skin.label}</strong><em>{skin.subtitle}</em></span>
                    <small>{skin.description}</small>
                    <i>{skin.inspiration}</i>
                  </span>
                  <span className="skin-option__check" aria-hidden="true">{selected && <Check size={13} />}</span>
                </button>
              );
            })}
          </div>
          <div className="skin-artwork-control">
            <span className={`skin-artwork-control__preview skin-option--${selectedSkin.value}`} aria-hidden="true">
              <span className="skin-option__preview">
                {selectedArtwork && <img src={selectedArtwork.url} alt="" />}
                <i /><b />
              </span>
            </span>
            <span className="skin-artwork-control__copy">
              <strong>{selectedSkin.label} · {selectedArtwork ? "自定义背景" : "内置背景"}</strong>
              <small>{selectedArtwork ? "图片已复制到应用用户数据目录，原文件移动后仍然有效。" : "使用随安装包提供的原创主题画面。"}</small>
              <i>PNG / JPEG / WebP · 最大 25 MB</i>
            </span>
            <span className="skin-artwork-control__actions">
              <button type="button" disabled={artworkBusy} onClick={() => onChooseSkinArtwork(preferences.skin)}>
                <ImagePlus size={14} />{artworkBusy ? "正在处理" : selectedArtwork ? "更换图片" : "选择图片"}
              </button>
              <button type="button" disabled={artworkBusy || !selectedArtwork} onClick={() => onResetSkinArtwork(preferences.skin)}>
                <RotateCcw size={13} />恢复内置
              </button>
            </span>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading"><span>明暗与密度</span><small>可与任意皮肤独立组合</small></div>
          <div className="theme-options">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button type="button" key={value} className={preferences.theme === value ? "is-active" : ""} onClick={() => onPreferencesChange(Object.freeze({ ...preferences, theme: value }))}>
                <Icon size={17} /><span>{label}</span>{preferences.theme === value && <Check size={13} />}
              </button>
            ))}
          </div>
          <div className="setting-row"><span><strong>紧凑密度</strong><small>减少消息与侧栏的垂直留白</small></span><Toggle label="紧凑密度" checked={preferences.density === "compact"} onChange={(checked) => onPreferencesChange(Object.freeze({ ...preferences, density: checked ? "compact" : "comfortable" }))} /></div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading"><span>Pi 运行方式</span><small>立即作用于当前会话</small></div>
          <div className="setting-row"><span><strong>自动压缩上下文</strong><small>接近模型窗口上限时生成摘要</small></span><Toggle label="自动压缩上下文" checked={bootstrap.state.autoCompactionEnabled} onChange={onAutoCompactionChange} /></div>
          <div className="setting-row"><span><strong>自动重试</strong><small>提供方拥塞、限流或 5xx 时重试</small></span><Toggle label="自动重试" checked={preferences.autoRetry} onChange={(checked) => onPreferencesChange(Object.freeze({ ...preferences, autoRetry: checked }))} /></div>
          <label className="setting-row setting-row--select"><span><strong>引导消息</strong><small>工作中发送的 steer 消息如何交付</small></span><select value={bootstrap.state.steeringMode} onChange={(event) => onSteeringModeChange(event.target.value as "all" | "one-at-a-time")}><option value="one-at-a-time">逐条</option><option value="all">一次全部</option></select></label>
          <label className="setting-row setting-row--select"><span><strong>后续消息</strong><small>任务结束后排队消息如何交付</small></span><select value={bootstrap.state.followUpMode} onChange={(event) => onFollowUpModeChange(event.target.value as "all" | "one-at-a-time")}><option value="one-at-a-time">逐条</option><option value="all">一次全部</option></select></label>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading"><span>项目权限</span><small>{bootstrap.project.name}</small></div>
          <div className={`trust-status ${bootstrap.project.trusted ? "is-trusted" : ""}`}>
            {bootstrap.project.trusted ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
            <span><strong>{bootstrap.project.trusted ? "已信任项目资源" : "受限模式"}</strong><small>{bootstrap.project.trusted ? "项目级设置、扩展与技能已启用。" : "项目级可执行资源不会加载。"}</small></span>
            <button type="button" onClick={() => onRestartTrust(!bootstrap.project.trusted)}>{bootstrap.project.trusted ? "改为受限" : "信任并重启"}</button>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading"><span>快捷键</span><Keyboard size={14} /></div>
          <div className="shortcut-grid"><span>新建会话 <kbd>Ctrl N</kbd></span><span>搜索与命令 <kbd>Ctrl K</kbd></span><span>聚焦输入框 <kbd>Ctrl L</kbd></span><span>停止生成 <kbd>Esc</kbd></span><span>打开终端 <kbd>Ctrl `</kbd></span><span>切换检查器 <kbd>Ctrl I</kbd></span></div>
        </section>

        <section className="settings-section settings-about">
          <div><span className="settings-about__signature">Stella</span><p>Pi Workbench · Pi v{bootstrap.piVersion}</p></div>
          <div><button type="button" onClick={() => onOpenLink("https://github.com/earendil-works/pi")}>Pi 项目 <ExternalLink size={12} /></button><button type="button" onClick={() => onOpenLink("https://github.com/Fei-Away/Codex-Dream-Skin")}>视觉参考 <ExternalLink size={12} /></button></div>
        </section>
      </div>
    </Modal>
  );
}
