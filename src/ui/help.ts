import { FORMAT_MODES } from '../presets/prompts';
import { closeMenu, h, openMenu } from './dom';
import { openSettings } from './settings';

/** 格式处理说明（工具条上的「?」） */
export function openFormatHelp(anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  openMenu([
    h('div', { class: 'help-pop' },
      h('h4', {}, '格式处理：全部交给模型'),
      h('p', {}, '本地只按空行把原文分段，原文一个字都不改（包括 LaTeX 命令、注释、宏、Markdown、HTML）。格式的去除或保留，由模型按提示词里的「格式规则」完成。'),
      h('ul', {}, FORMAT_MODES.map(f => h('li', {}, h('b', {}, f.label), '：', f.desc))),
      h('p', {}, '规则写在提示词里，可以在设置中修改、随时重置；论文里的自定义宏（如 \\ours）可以在设置里写一句说明，模型就知道它代表什么。'),
      h('div', { class: 'help-foot' },
        h('button', { class: 'btn sm', onclick: () => { closeMenu(); openSettings('format'); } }, '查看 / 修改格式规则'))),
  ], r.left, r.bottom + 6, 'wide');
}
