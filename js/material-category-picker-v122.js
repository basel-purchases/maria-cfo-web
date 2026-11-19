import {esc} from './utils.js?v=1.0';
import {normalizeMaterialCategoryV122,cleanMaterialCategoryNameV122,findMaterialCategoryV122,suggestMaterialCategoriesV122,ensureMaterialCategoryV122} from './material-category-manager-v122.js?v=1.0.22';
import * as api from './api.js?v=1.0.22';
import {toast,friendlyError} from './ui.js?v=1.0.22';

let sequence = 0;
export function materialCategoryFieldV122(categories = [], selectedName = '') {
  const listId = `material-category-suggestions-v122-${++sequence}`;
  return `<div class="field full material-category-picker-v122">
    <label for="${listId}-input">تصنيف المادة</label>
    <div class="material-category-entry-v122">
      <input id="${listId}-input" type="text" name="category_name" list="${listId}"
        value="${esc(selectedName)}" maxlength="120" autocomplete="off"
        placeholder="ابحث أو اكتب تصنيفًا جديدًا مثل مشروبات باردة">
      <button class="btn secondary material-category-create-v122" type="button">+ إضافة تصنيف</button>
    </div>
    <datalist id="${listId}">${categories.map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
    <div class="material-category-suggestions-v122" aria-label="تصنيفات المواد المقترحة"></div>
    <small class="metric-note material-category-hint-v122">اختر تصنيفًا سابقًا من الاقتراحات أو اكتب اسمًا جديدًا. يمكنك إضافته بالزر أو بمجرد حفظ المادة.</small>
  </div>`;
}

export function attachMaterialCategoryPickerV122(form, initialCategories = []) {
  const field = form.querySelector('.material-category-picker-v122');
  if (!field) throw new Error('MATERIAL_CATEGORY_PICKER_MISSING');
  const input = field.querySelector('[name="category_name"]');
  const add = field.querySelector('.material-category-create-v122');
  const suggestions = field.querySelector('.material-category-suggestions-v122');
  const dataList = field.querySelector('datalist');
  const hint = field.querySelector('.material-category-hint-v122');
  let categories = [...initialCategories];
  let busy = false;
  const updateOptions = () => {
    dataList.innerHTML = categories.map(c => `<option value="${esc(c.name)}"></option>`).join('');
  };
  const draw = () => {
    const value = cleanMaterialCategoryNameV122(input.value);
    const match = findMaterialCategoryV122(categories, value);
    const options = suggestMaterialCategoriesV122(categories, value);
    suggestions.innerHTML = options.map(c => `<button type="button" class="mini-btn material-category-choice-v122" data-category-id="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    suggestions.querySelectorAll('[data-category-id]').forEach(button => {
      button.onclick = () => {
        const selected = categories.find(c => String(c.id) === button.dataset.categoryId);
        if (selected) {input.value = selected.name;draw();input.focus();}
      };
    });
    add.disabled = busy || !value;
    add.textContent = match ? '✓ تصنيف موجود' : '+ إضافة تصنيف';
    hint.textContent = !value ? 'بدون تصنيف. اكتب اسمًا لرؤية الاقتراحات.' :
      match ? 'هذا تصنيف موجود وسيُسند إلى المادة عند حفظها.' :
      'تصنيف جديد؛ اضغط «إضافة تصنيف» أو احفظ المادة ليُضاف تلقائيًا.';
  };
  input.addEventListener('input', draw);
  add.onclick = async () => {
    if (busy) return;
    const name = cleanMaterialCategoryNameV122(input.value);
    if (!name) {toast('اكتب اسم التصنيف أولًا.', 'error');return;}
    busy = true; add.disabled = true;
    try {
      const id = await ensureMaterialCategoryV122(name, {
        categories,loadCategories:api.materialCategoriesV023,
        createCategory: category => api.manageMaterialCategoryV122('add', null, category),
      });
      categories = await api.materialCategoriesV023();
      const saved = categories.find(c => String(c.id) === String(id));
      input.value = saved?.name || name;
      updateOptions();
      toast('أصبح التصنيف متاحًا. اضغط «حفظ المادة» لإسناده إلى المادة.', 'success');
    } catch (error) {toast(friendlyError(error, 'تعذر إضافة تصنيف المواد.'), 'error');}
    finally {busy = false;draw();}
  };
  updateOptions(); draw();
  return {
    input,
    async resolve() {
      return ensureMaterialCategoryV122(input.value, {
        categories,loadCategories:api.materialCategoriesV023,
        createCategory: category => api.manageMaterialCategoryV122('add', null, category),
      });
    },
  };
}
