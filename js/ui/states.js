import { html } from '../core/utils.js';

export const skeletonRows = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton" style="height:56px;margin-bottom:10px"></div>').join('');
export const emptyState = (title, text = '') => html`<div class="empty"><h4>${title}</h4><p>${text}</p></div>`.toString();
export const errorState = (message) => html`<div class="alert alert-error" role="alert">${message}</div>`.toString();

/** Standard loading -> content / empty / error flow for any list container. */
export async function renderAsync(container, load, render, { empty = 'Nothing here yet.', skeleton = 3 } = {}) {
  container.innerHTML = skeletonRows(skeleton);
  try {
    const data = await load();
    container.innerHTML = (Array.isArray(data) && data.length === 0) ? emptyState(empty) : render(data);
  } catch (e) { console.error(e); container.innerHTML = errorState(e.message ?? 'Something went wrong.'); }
}
