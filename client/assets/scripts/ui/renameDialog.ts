import { BlockInputEvents, Color, EditBox, Label, type Node, UITransform } from 'cc';
import type { ActionResult } from '../services/errors';
import { PET_NAME_MAX, normalizePetName } from '../services/petName';
import { createButton, createPanel } from './kit';
import { makeLabel, makeNode, paint, place } from './nodes';
import type { PlaceholderFrames } from './placeholders';
import { COLORS, FONT_SIZE } from './theme';

/** 宠物改名（UI-06）：12 字上限 + 非法字符提示；提交仍以服务端返回为准。 */

export interface RenameDialogOptions {
  initial: string;
  onConfirm: (name: string) => Promise<ActionResult> | ActionResult;
  onClose: () => void;
}

/** 打开改名弹窗；成功后由控制器刷新场景（store 变化会整树重绘）。 */
export function showRenameDialog(root: Node, frames: PlaceholderFrames, options: RenameDialogOptions): Node {
  const cover = makeNode('rename-cover', root, 1920, 1080);
  paint(cover, frames.white, '#05090c');
  cover.addComponent(BlockInputEvents);
  place(cover, 0, 0);

  const panel = createPanel(cover, frames, 900, 460);
  const title = makeLabel(panel, '宠物改名', { fontSize: FONT_SIZE.title, color: COLORS.text });
  place(title.node, 0, 160);

  const boxNode = makeNode('rename-editbox', panel, 640, 76);
  paint(boxNode, frames.white, '#0f1a22');
  place(boxNode, 0, 66);
  const boxBg = makeNode('rename-editbox-bg', boxNode, 620, 64);
  paint(boxBg, frames.white, '#0f1a22');
  place(boxBg, 0, 0);

  const edit = boxNode.addComponent(EditBox);
  const placeholderText = '输入新名字（最多 12 字）';
  edit.placeholder = placeholderText;
  edit.maxLength = PET_NAME_MAX;
  edit.string = options.initial;

  // EditBox 会自己创建 TEXT_LABEL / PLACEHOLDER_LABEL（默认 string 是 "label"）。
  // 复用它们并统一样式，避免再出现一个游离的 "label" 文本。
  const ensureLabel = (name: string, text: string, fontSize: number, color: string): Label => {
    const node = boxNode.getChildByName(name) ?? makeNode(name, boxNode, 596, 60);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.3);
    label.color = new Color().fromHEX(color);
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    node.getComponent(UITransform)?.setContentSize(596, 60);
    place(node, 0, 0);
    return label;
  };

  const textLabel = ensureLabel('TEXT_LABEL', options.initial, 30, COLORS.text);
  const placeholderLabel = ensureLabel('PLACEHOLDER_LABEL', placeholderText, 26, COLORS.textDim);
  edit.textLabel = textLabel;
  edit.placeholderLabel = placeholderLabel;
  textLabel.node.active = options.initial.length > 0;
  placeholderLabel.node.active = options.initial.length === 0;

  const error = makeLabel(panel, '', {
    fontSize: FONT_SIZE.small,
    color: COLORS.danger,
    width: 700,
    height: 40,
    wrap: true,
  });
  place(error.node, 0, -12);

  const hint = makeLabel(panel, '可使用中文、字母、数字、空格和 ·_-', {
    fontSize: FONT_SIZE.small,
    color: COLORS.textDim,
  });
  place(hint.node, 0, -52);

  let busy = false;
  const cancel = createButton(panel, frames, {
    text: '取消',
    width: 300,
    height: 80,
    variant: 'secondary',
    onClick: () => options.onClose(),
  });
  place(cancel, -190, -150);

  const confirm = createButton(panel, frames, {
    text: '保存',
    width: 300,
    height: 80,
    variant: 'primary',
    onClick: () => void submit(),
  });
  place(confirm, 190, -150);

  edit.node.on('text-changed', () => {
    error.string = '';
    textLabel.node.active = edit.string.length > 0;
    placeholderLabel.node.active = edit.string.length === 0;
  });

  async function submit(): Promise<void> {
    if (busy) return;
    const checked = normalizePetName(edit.string);
    if (!checked.ok) {
      error.string = checked.error ?? '名字不合法';
      return;
    }
    busy = true;
    const result = await options.onConfirm(checked.name);
    busy = false;
    if (!result.ok) {
      error.string = result.message;
      return;
    }
    options.onClose();
  }

  return cover;
}
