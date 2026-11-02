import { BlockInputEvents, Color, EditBox, Label, Node, UITransform } from 'cc';
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

  const labelNode = makeNode('edit-label', boxNode, 596, 60);
  const textLabel = labelNode.addComponent(Label);
  textLabel.fontSize = 30;
  textLabel.lineHeight = 40;
  textLabel.color = new Color().fromHEX(COLORS.text);
  textLabel.verticalAlign = Label.VerticalAlign.CENTER;
  textLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
  labelNode.getComponent(UITransform)?.setContentSize(596, 60);

  const placeholderNode = makeNode('edit-placeholder', boxNode, 596, 60);
  const placeholderLabel = placeholderNode.addComponent(Label);
  placeholderLabel.fontSize = 26;
  placeholderLabel.lineHeight = 36;
  placeholderLabel.color = new Color().fromHEX(COLORS.textDim);
  placeholderLabel.verticalAlign = Label.VerticalAlign.CENTER;
  placeholderLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
  placeholderNode.getComponent(UITransform)?.setContentSize(596, 60);

  const edit = boxNode.addComponent(EditBox);
  edit.textLabel = textLabel;
  edit.placeholderLabel = placeholderLabel;
  edit.placeholder = '输入新名字（最多 12 字）';
  edit.maxLength = PET_NAME_MAX;
  edit.string = options.initial;

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
