const BASE_CURRENCY = "SGD";
const DEFAULT_INPUT_CURRENCY = "CNY";

const state = {
  members: [],
  expenses: [],
  currencies: {},
};

const memberForm = document.querySelector("#member-form");
const memberNameInput = document.querySelector("#member-name");
const memberList = document.querySelector("#member-list");
const memberEmpty = document.querySelector("#member-empty");

const expenseForm = document.querySelector("#expense-form");
const expenseTitleInput = document.querySelector("#expense-title");
const expenseAmountInput = document.querySelector("#expense-amount");
const expenseCurrencySelect = document.querySelector("#expense-currency");
const expenseDateInput = document.querySelector("#expense-date");
const paidBySelect = document.querySelector("#expense-paid-by");
const splitModeSelect = document.querySelector("#expense-split-mode");
const participantOptions = document.querySelector("#participant-options");
const customSplitSection = document.querySelector("#custom-split");
const customSplitInputs = document.querySelector("#custom-split-inputs");
const customTotalHint = document.querySelector("#custom-total-hint");
const fxPreview = document.querySelector("#fx-preview");

const balanceList = document.querySelector("#balance-list");
const settlementList = document.querySelector("#settlement-list");
const expenseList = document.querySelector("#expense-list");
const expenseSubmitButton = document.querySelector("#expense-submit-button");
const expenseCancelButton = document.querySelector("#expense-cancel-button");
const resetSliderInput = document.querySelector("#reset-slider-input");
const syncButton = document.querySelector("#sync-button");
const syncStatus = document.querySelector("#sync-status");

let pendingExpenseDraft = null;
let editingExpenseId = null;

memberForm.addEventListener("submit", handleMemberSubmit);
expenseForm.addEventListener("submit", handleExpenseSubmit);
splitModeSelect.addEventListener("change", renderCustomSplitState);
participantOptions.addEventListener("change", () => {
  renderCustomInputs();
  renderCustomSplitState();
});
customSplitInputs.addEventListener("input", updateCustomTotalHint);
expenseCurrencySelect.addEventListener("change", updateExpenseMetaPreview);
expenseAmountInput.addEventListener("input", updateExpenseMetaPreview);
expenseDateInput.addEventListener("input", updateExpenseMetaPreview);
expenseCancelButton.addEventListener("click", cancelExpenseEdit);
resetSliderInput.addEventListener("input", handleResetSlide);
syncButton.addEventListener("click", () => fetchAll({ preserveForm: true }));

window.addEventListener("focus", () => fetchState({ preserveForm: true, silent: true }));
setInterval(() => {
  if (document.visibilityState === "visible") {
    fetchState({ preserveForm: true, silent: true });
  }
}, 15000);

expenseDateInput.value = todayIsoDate();
render();
fetchAll();

async function fetchAll(options = {}) {
  await Promise.all([
    fetchCurrencies(options),
    fetchState(options),
  ]);
}

async function fetchCurrencies(options = {}) {
  const { silent = false } = options;

  try {
    const payload = await request("/api/currencies");
    state.currencies = payload?.currencies || {};
    renderCurrencyOptions(captureExpenseDraft());
  } catch (error) {
    if (!silent) {
      setSyncStatus(error.message || "Could not load currencies.", "error");
    }
  }
}

async function fetchState(options = {}) {
  const { preserveForm = false, silent = false } = options;
  const draft = preserveForm ? captureExpenseDraft() : pendingExpenseDraft;
  pendingExpenseDraft = null;

  try {
    if (!silent) {
      setSyncStatus("Syncing shared trip...", "neutral");
    }

    const nextState = await request("/api/state");
    state.members = Array.isArray(nextState.members) ? nextState.members : [];
    state.expenses = Array.isArray(nextState.expenses) ? nextState.expenses : [];
    render(draft);
    setSyncStatus(`Synced ${formatSyncTime(new Date())}`, "success");
  } catch (error) {
    render(draft);
    setSyncStatus(error.message || "Could not reach the shared trip server.", "error");
  }
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const name = memberNameInput.value.trim();
  if (!name) {
    return;
  }

  try {
    await request("/api/members", {
      method: "POST",
      body: { name },
    });
    memberForm.reset();
    await fetchState();
  } catch (error) {
    alert(error.message);
  }
}

async function handleExpenseSubmit(event) {
  event.preventDefault();

  if (state.members.length < 2) {
    alert("Add at least two trip members before recording an expense.");
    return;
  }

  const title = expenseTitleInput.value.trim();
  const amount = Number(expenseAmountInput.value);
  const currencyCode = expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY;
  const expenseDate = expenseDateInput.value;
  const paidBy = paidBySelect.value;
  const splitMode = splitModeSelect.value;
  const participantIds = getSelectedParticipantIds();

  if (!title || !amount || amount <= 0) {
    alert("Enter a title and a valid total amount.");
    return;
  }

  if (!expenseDate) {
    alert("Choose the date for this expense.");
    return;
  }

  if (!paidBy) {
    alert("Choose who paid the expense.");
    return;
  }

  if (participantIds.length === 0) {
    alert("Choose at least one member to split this expense with.");
    return;
  }

  let shares;
  if (splitMode === "equal") {
    shares = buildEqualShares(participantIds, amount);
  } else {
    shares = buildCustomShares(participantIds, amount);
    if (!shares) {
      return;
    }
  }

  try {
    await request(editingExpenseId ? `/api/expenses/${editingExpenseId}` : "/api/expenses", {
      method: editingExpenseId ? "PUT" : "POST",
      body: {
        title,
        amount: roundCurrency(amount),
        currencyCode,
        expenseDate,
        paidBy,
        splitMode,
        shares,
      },
    });
    clearExpenseForm();
    await fetchState();
  } catch (error) {
    alert(error.message);
  }
}

function buildEqualShares(participantIds, amount) {
  const totalCents = Math.round(amount * 100);
  const base = Math.floor(totalCents / participantIds.length);
  const remainder = totalCents - base * participantIds.length;

  return participantIds.map((participantId, index) => ({
    memberId: participantId,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
}

function buildCustomShares(participantIds, amount) {
  const shares = participantIds.map((participantId) => {
    const input = customSplitInputs.querySelector(`[data-member-id="${participantId}"]`);
    return {
      memberId: participantId,
      amount: roundCurrency(Number(input?.value || 0)),
    };
  });

  const total = roundCurrency(shares.reduce((sum, share) => sum + share.amount, 0));
  if (Math.abs(total - roundCurrency(amount)) > 0.009) {
    alert("Custom amounts must add up exactly to the total expense.");
    return null;
  }

  return shares;
}

function getSelectedParticipantIds() {
  return [...participantOptions.querySelectorAll("input:checked")].map((input) => input.value);
}

async function handleResetSlide() {
  if (Number(resetSliderInput.value) < 100) {
    return;
  }

  try {
    const confirmed = window.confirm("Reset all members and expenses for this trip?");
    if (!confirmed) {
      return;
    }
    await request("/api/reset", { method: "POST" });
    clearExpenseForm();
    await fetchState();
  } catch (error) {
    alert(error.message);
  } finally {
    resetSliderInput.value = "0";
  }
}

function render(draft = captureExpenseDraft()) {
  renderMembers();
  renderExpenseControls(draft);
  renderBalances();
  renderSettlements();
  renderExpenses();
}

function renderMembers() {
  memberList.innerHTML = "";
  memberEmpty.classList.toggle("hidden", state.members.length > 0);

  const template = document.querySelector("#member-chip-template");

  state.members.forEach((member) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector("span").textContent = member.name;
    node.querySelector("button").addEventListener("click", () => removeMember(member.id));
    memberList.appendChild(node);
  });
}

function renderExpenseControls(draft) {
  const canAddExpense = state.members.length >= 2;
  const nextDraft = normalizeDraft(draft);

  expenseTitleInput.disabled = !canAddExpense;
  expenseAmountInput.disabled = !canAddExpense;
  expenseCurrencySelect.disabled = !canAddExpense;
  expenseDateInput.disabled = !canAddExpense;
  paidBySelect.disabled = !canAddExpense;
  splitModeSelect.disabled = !canAddExpense;
  expenseForm.querySelector("button[type='submit']").disabled = !canAddExpense;

  renderCurrencyOptions(nextDraft);

  paidBySelect.innerHTML = state.members.length
    ? state.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join("")
    : `<option value="">Add members first</option>`;

  if (state.members.length) {
    const fallbackPayer = state.members[0].id;
    paidBySelect.value = state.members.some((member) => member.id === nextDraft.paidBy)
      ? nextDraft.paidBy
      : fallbackPayer;
  }

  expenseTitleInput.value = nextDraft.title;
  expenseAmountInput.value = nextDraft.amount;
  expenseDateInput.value = nextDraft.expenseDate;
  splitModeSelect.value = nextDraft.splitMode;
  expenseSubmitButton.textContent = editingExpenseId ? "Update expense" : "Save expense";
  expenseCancelButton.classList.toggle("hidden", !editingExpenseId);

  const selectedParticipants = new Set(
    nextDraft.participants.length ? nextDraft.participants : state.members.map((member) => member.id)
  );

  participantOptions.innerHTML = state.members
    .map((member) => {
      const checked = selectedParticipants.has(member.id) ? "checked" : "";
      return `
        <label class="check-item">
          <input type="checkbox" value="${member.id}" ${checked}>
          <span>${escapeHtml(member.name)}</span>
        </label>
      `;
    })
    .join("");

  renderCustomInputs(nextDraft.customShares);
  renderCustomSplitState();
  updateExpenseMetaPreview();
}

function renderCurrencyOptions(draft) {
  const selectedCurrency = draft?.currencyCode || expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY;
  const entries = Object.entries(state.currencies);

  if (entries.length === 0) {
    expenseCurrencySelect.innerHTML = `
      <option value="${DEFAULT_INPUT_CURRENCY}">${DEFAULT_INPUT_CURRENCY} - Chinese Yuan Renminbi</option>
      <option value="${BASE_CURRENCY}">${BASE_CURRENCY} - Singapore Dollar</option>
    `;
    expenseCurrencySelect.value = DEFAULT_INPUT_CURRENCY;
    return;
  }

  expenseCurrencySelect.innerHTML = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, name]) => `<option value="${code}">${code} - ${escapeHtml(name)}</option>`)
    .join("");

  expenseCurrencySelect.value = state.currencies[selectedCurrency] ? selectedCurrency : DEFAULT_INPUT_CURRENCY;
}

function renderCustomInputs(customShares = {}) {
  const participantIds = getSelectedParticipantIds();
  customSplitInputs.innerHTML = participantIds
    .map((participantId) => {
      const member = state.members.find((entry) => entry.id === participantId);
      const existingValue = customShares[participantId] ?? "";
      return `
        <label>
          ${escapeHtml(member?.name || "")}
          <input
            type="number"
            min="0"
            step="0.01"
            value="${existingValue}"
            data-member-id="${participantId}"
            placeholder="0.00"
          >
        </label>
      `;
    })
    .join("");
  updateCustomTotalHint();
}

function renderCustomSplitState() {
  const showCustom = splitModeSelect.value === "custom";
  customSplitSection.classList.toggle("hidden", !showCustom);
}

function renderBalances() {
  const balances = computeBalances();
  balanceList.innerHTML = "";

  if (state.members.length === 0) {
    balanceList.innerHTML = `<div class="empty-state">Balances will appear after you add trip members.</div>`;
    return;
  }

  balances.forEach(({ memberId, amount }) => {
    const member = findMember(memberId);
    const className = amount >= 0 ? "positive" : "negative";
    const prefix = amount >= 0 ? "is owed" : "owes";

    balanceList.insertAdjacentHTML(
      "beforeend",
      `
        <div class="summary-item">
          <strong>${escapeHtml(member.name)}</strong>
          <span class="${className}">${prefix} ${formatCurrency(Math.abs(amount), BASE_CURRENCY)}</span>
        </div>
      `
    );
  });
}

function renderSettlements() {
  const settlements = simplifyDebts(computeBalances());
  settlementList.innerHTML = "";

  if (settlements.length === 0) {
    settlementList.innerHTML = `<div class="empty-state">No repayments needed yet.</div>`;
    return;
  }

  settlements.forEach((settlement) => {
    settlementList.insertAdjacentHTML(
      "beforeend",
      `
        <div class="summary-item">
          <strong>${escapeHtml(findMember(settlement.from).name)}</strong>
          <span>pays ${escapeHtml(findMember(settlement.to).name)} ${formatCurrency(settlement.amount, BASE_CURRENCY)}</span>
        </div>
      `
    );
  });
}

function renderExpenses() {
  expenseList.innerHTML = "";

  if (state.expenses.length === 0) {
    expenseList.innerHTML = `<div class="empty-state">Your expense history will appear here.</div>`;
    return;
  }

  state.expenses.forEach((expense) => {
    const payer = findMember(expense.paidBy);
    const splitSummary = expense.shares
      .map((share) => {
        const original = formatCurrency(share.amount, expense.currencyCode || BASE_CURRENCY);
        const sgd = formatCurrency(share.amountSgd || share.amount, BASE_CURRENCY);
        return `${findMember(share.memberId).name}: ${original} (${sgd})`;
      })
      .join(" | ");

    const convertedNote = expense.currencyCode === BASE_CURRENCY
      ? `Settles directly in ${BASE_CURRENCY}`
      : `${formatCurrency(expense.amount, expense.currencyCode)} -> ${formatCurrency(expense.amountSgd, BASE_CURRENCY)} at ${expense.fxRateToSgd.toFixed(4)} on ${expense.fxDate}`;

    expenseList.insertAdjacentHTML(
      "beforeend",
      `
        <article class="expense-card">
          <div class="expense-card-header">
            <div>
              <h3>${escapeHtml(expense.title)}</h3>
              <p>${escapeHtml(payer.name)} paid ${formatCurrency(expense.amount, expense.currencyCode || BASE_CURRENCY)} (${formatCurrency(expense.amountSgd, BASE_CURRENCY)})</p>
            </div>
            <small>${formatDate(expense.expenseDate || expense.createdAt)}</small>
          </div>
          <div class="expense-card-meta">
            <p>${expense.splitMode === "equal" ? "Equal split" : "Custom split"}</p>
            <p>${escapeHtml(convertedNote)}</p>
          </div>
          <p>${escapeHtml(splitSummary)}</p>
          <div class="expense-card-actions">
            <button type="button" class="ghost-button" data-edit-expense-id="${expense.id}">Edit</button>
          </div>
        </article>
      `
    );
  });

  expenseList.querySelectorAll("[data-edit-expense-id]").forEach((button) => {
    button.addEventListener("click", () => startExpenseEdit(button.dataset.editExpenseId));
  });
}

async function removeMember(memberId) {
  try {
    await request(`/api/members/${memberId}`, {
      method: "DELETE",
    });
    await fetchState();
  } catch (error) {
    alert(error.message);
  }
}

function computeBalances() {
  const balances = new Map(state.members.map((member) => [member.id, 0]));

  state.expenses.forEach((expense) => {
    balances.set(
      expense.paidBy,
      roundCurrency((balances.get(expense.paidBy) || 0) + (expense.amountSgd || expense.amount))
    );
    expense.shares.forEach((share) => {
      balances.set(
        share.memberId,
        roundCurrency((balances.get(share.memberId) || 0) - (share.amountSgd || share.amount))
      );
    });
  });

  return [...balances.entries()]
    .map(([memberId, amount]) => ({ memberId, amount: roundCurrency(amount) }))
    .sort((left, right) => right.amount - left.amount);
}

function simplifyDebts(balances) {
  const creditors = balances
    .filter((entry) => entry.amount > 0.009)
    .map((entry) => ({ ...entry }));
  const debtors = balances
    .filter((entry) => entry.amount < -0.009)
    .map((entry) => ({ memberId: entry.memberId, amount: Math.abs(entry.amount) }));

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = roundCurrency(Math.min(creditor.amount, debtor.amount));

    settlements.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amount,
    });

    creditor.amount = roundCurrency(creditor.amount - amount);
    debtor.amount = roundCurrency(debtor.amount - amount);

    if (creditor.amount <= 0.009) {
      creditorIndex += 1;
    }
    if (debtor.amount <= 0.009) {
      debtorIndex += 1;
    }
  }

  return settlements;
}

function updateCustomTotalHint() {
  const total = [...customSplitInputs.querySelectorAll("input")].reduce(
    (sum, input) => sum + Number(input.value || 0),
    0
  );
  customTotalHint.textContent = `Total assigned: ${formatCurrency(total, expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY)}`;
}

function updateExpenseMetaPreview() {
  const amount = Number(expenseAmountInput.value || 0);
  const currencyCode = expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY;
  const expenseDate = expenseDateInput.value || todayIsoDate();

  if (!amount) {
    fxPreview.textContent = `Settlement base: ${BASE_CURRENCY}. Historical rate for ${currencyCode} on ${expenseDate} will be applied when you save.`;
    updateCustomTotalHint();
    return;
  }

  if (currencyCode === BASE_CURRENCY) {
    fxPreview.textContent = `Settlement base: ${BASE_CURRENCY}. ${formatCurrency(amount, BASE_CURRENCY)} stays ${formatCurrency(amount, BASE_CURRENCY)}.`;
  } else {
    fxPreview.textContent = `Settlement base: ${BASE_CURRENCY}. ${formatCurrency(amount, currencyCode)} will use the ${expenseDate} historical rate when you save.`;
  }

  updateCustomTotalHint();
}

function captureExpenseDraft() {
  return {
    title: expenseTitleInput.value || "",
    amount: expenseAmountInput.value || "",
    currencyCode: expenseCurrencySelect.value || DEFAULT_INPUT_CURRENCY,
    expenseDate: expenseDateInput.value || todayIsoDate(),
    paidBy: paidBySelect.value || "",
    splitMode: splitModeSelect.value || "equal",
    participants: getSelectedParticipantIds(),
    customShares: Object.fromEntries(
      [...customSplitInputs.querySelectorAll("input[data-member-id]")].map((input) => [
        input.dataset.memberId,
        input.value,
      ])
    ),
  };
}

function normalizeDraft(draft) {
  const baseDraft = draft || emptyExpenseDraft();
  return {
    title: baseDraft.title || "",
    amount: baseDraft.amount || "",
    currencyCode: baseDraft.currencyCode || DEFAULT_INPUT_CURRENCY,
    expenseDate: baseDraft.expenseDate || todayIsoDate(),
    paidBy: baseDraft.paidBy || "",
    splitMode: baseDraft.splitMode === "custom" ? "custom" : "equal",
    participants: Array.isArray(baseDraft.participants) ? baseDraft.participants : [],
    customShares: baseDraft.customShares || {},
  };
}

function emptyExpenseDraft() {
  return {
    title: "",
    amount: "",
    currencyCode: DEFAULT_INPUT_CURRENCY,
    expenseDate: todayIsoDate(),
    paidBy: "",
    splitMode: "equal",
    participants: [],
    customShares: {},
  };
}

function startExpenseEdit(expenseId) {
  const expense = state.expenses.find((entry) => entry.id === expenseId);
  if (!expense) {
    return;
  }

  editingExpenseId = expenseId;
  expenseTitleInput.value = expense.title;
  expenseAmountInput.value = expense.amount;
  expenseCurrencySelect.value = expense.currencyCode || DEFAULT_INPUT_CURRENCY;
  expenseDateInput.value = expense.expenseDate || todayIsoDate();
  paidBySelect.value = expense.paidBy;
  splitModeSelect.value = expense.splitMode;

  participantOptions.querySelectorAll("input").forEach((input) => {
    input.checked = expense.participants.includes(input.value);
  });

  renderCustomInputs(
    Object.fromEntries(expense.shares.map((share) => [share.memberId, share.amount]))
  );
  renderCustomSplitState();
  updateExpenseMetaPreview();
  renderExpenseControls(captureExpenseDraft());
  expenseTitleInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelExpenseEdit() {
  clearExpenseForm();
  render();
}

function clearExpenseForm() {
  editingExpenseId = null;
  expenseForm.reset();
  splitModeSelect.value = "equal";
  expenseCurrencySelect.value = DEFAULT_INPUT_CURRENCY;
  expenseDateInput.value = todayIsoDate();
  pendingExpenseDraft = {
    ...emptyExpenseDraft(),
    participants: state.members.map((member) => member.id),
  };
  resetSliderInput.value = "0";
}

function findMember(memberId) {
  return state.members.find((member) => member.id === memberId) || { name: "Unknown member" };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value, currencyCode) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(roundCurrency(value));
  } catch {
    return `${currencyCode} ${roundCurrency(value).toFixed(2)}`;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatSyncTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function setSyncStatus(message, tone) {
  syncStatus.textContent = message;
  syncStatus.dataset.tone = tone;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }

  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
