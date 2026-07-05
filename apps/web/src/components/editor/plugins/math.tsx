import { mathSchemaPlugin } from '@boppl/schema';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Schema halves (mathInlineNode, mathBlockNode, remarkMathPlugin) live in
// @boppl/schema so the headless Node bridge in apps/api uses the same
// definitions. Only the node views (KaTeX rendering + click-to-edit) are
// local to the browser.

/* ---------------------------------------------------------------------- *
 *  Node views — render KaTeX, click-to-edit
 * ---------------------------------------------------------------------- */
class MathInlineNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  node: PMNode;
  view: EditorView;
  getPos: () => number | undefined;
  private rendered: HTMLElement;
  private input: HTMLInputElement;
  private editing = false;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'math-inline';
    this.dom.setAttribute('data-type', 'math-inline');
    this.dom.contentEditable = 'false';

    this.rendered = document.createElement('span');
    this.rendered.className = 'math-inline-rendered';
    this.rendered.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setEditing(true);
    });

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'math-inline-input';
    this.input.style.display = 'none';
    this.input.value = (node.attrs.src as string) ?? '';
    this.input.addEventListener('blur', () => this.commit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        this.commit();
      }
    });

    this.dom.appendChild(this.rendered);
    this.dom.appendChild(this.input);
    this.render(node.attrs.src as string);
  }

  private render(src: string): void {
    this.rendered.classList.remove('math-error', 'math-empty');
    if (!src.trim()) {
      this.rendered.textContent = '$ $';
      this.rendered.classList.add('math-empty');
      return;
    }
    try {
      katex.render(src, this.rendered, {
        throwOnError: false,
        displayMode: false,
        output: 'html',
      });
    } catch {
      this.rendered.textContent = `$${src}$`;
      this.rendered.classList.add('math-error');
    }
  }

  private setEditing(editing: boolean): void {
    this.editing = editing;
    if (editing) {
      this.rendered.style.display = 'none';
      this.input.style.display = 'inline';
      this.input.value = (this.node.attrs.src as string) ?? '';
      this.input.focus();
      this.input.select();
    } else {
      this.input.style.display = 'none';
      this.rendered.style.display = 'inline';
    }
  }

  private commit(): void {
    if (!this.editing) return;
    const newSrc = this.input.value;
    const pos = this.getPos();
    if (pos === undefined) {
      this.setEditing(false);
      return;
    }
    if (newSrc !== ((this.node.attrs.src as string) ?? '')) {
      const { state, dispatch } = this.view;
      dispatch(state.tr.setNodeAttribute(pos, 'src', newSrc));
    }
    this.setEditing(false);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.editing) this.render(node.attrs.src as string);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(): boolean {
    return this.editing;
  }

  destroy(): void {}
}

class MathBlockNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null = null;
  node: PMNode;
  view: EditorView;
  getPos: () => number | undefined;
  private rendered: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private editing = false;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'math-block';
    this.dom.setAttribute('data-type', 'math-block');
    this.dom.contentEditable = 'false';

    this.rendered = document.createElement('div');
    this.rendered.className = 'math-block-rendered';
    this.rendered.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setEditing(true);
    });

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'math-block-input';
    this.textarea.style.display = 'none';
    this.textarea.value = (node.attrs.src as string) ?? '';
    this.textarea.rows = 3;
    this.textarea.spellcheck = false;
    this.textarea.addEventListener('blur', () => this.commit());
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.commit();
      }
    });

    this.dom.appendChild(this.rendered);
    this.dom.appendChild(this.textarea);
    this.render(node.attrs.src as string);
  }

  private render(src: string): void {
    this.rendered.classList.remove('math-error', 'math-empty');
    if (!src.trim()) {
      this.rendered.textContent = 'Empty math block — click to edit';
      this.rendered.classList.add('math-empty');
      return;
    }
    try {
      katex.render(src, this.rendered, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
      });
    } catch {
      this.rendered.textContent = src;
      this.rendered.classList.add('math-error');
    }
  }

  private setEditing(editing: boolean): void {
    this.editing = editing;
    if (editing) {
      this.rendered.style.display = 'none';
      this.textarea.style.display = 'block';
      this.textarea.value = (this.node.attrs.src as string) ?? '';
      this.textarea.focus();
      this.textarea.select();
    } else {
      this.textarea.style.display = 'none';
      this.rendered.style.display = 'block';
    }
  }

  private commit(): void {
    if (!this.editing) return;
    const newSrc = this.textarea.value;
    const pos = this.getPos();
    if (pos === undefined) {
      this.setEditing(false);
      return;
    }
    if (newSrc !== ((this.node.attrs.src as string) ?? '')) {
      const { state, dispatch } = this.view;
      dispatch(state.tr.setNodeAttribute(pos, 'src', newSrc));
    }
    this.setEditing(false);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.editing) this.render(node.attrs.src as string);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(): boolean {
    return this.editing;
  }

  destroy(): void {}
}

/* ---------------------------------------------------------------------- *
 *  Plugin registering both node views
 * ---------------------------------------------------------------------- */
export const mathNodeViews = $prose(
  () =>
    new Plugin({
      key: new PluginKey('boppl-math-node-views'),
      props: {
        nodeViews: {
          math_inline: (node, view, getPos) => new MathInlineNodeView(node, view, getPos),
          math_block: (node, view, getPos) => new MathBlockNodeView(node, view, getPos),
        },
      },
    }),
);

/* ---------------------------------------------------------------------- *
 *  Bundle — schema halves come from @boppl/schema so the server-side
 *  bridge in apps/api uses the same node definitions. Node views are
 *  appended on top for the browser.
 * ---------------------------------------------------------------------- */
export const mathPlugin = [...mathSchemaPlugin, mathNodeViews];
