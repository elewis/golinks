(async () => {
  const result = await browser.storage.sync.get(["defaultLinks", "localLinks"]);

  const defaultLinks = result.defaultLinks || {};
  const localLinks = result.localLinks || {};

  function cell(text) {
    const cell = document.createElement("td");
    const cellText = document.createTextNode(text);
    cell.appendChild(cellText);
    return cell;
  }

  function populateTable(tableId, links) {
    const table = document.getElementById(tableId);
    table.innerHTML = "";

    Object.entries(links).forEach(([golink, destination]) => {
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`));
      row.appendChild(cell(destination));
      table.appendChild(row);
    });
  }

  function populateUserLinksWithForm(links) {
    const table = document.getElementById("user-links");
    table.innerHTML = "";

    Object.entries(links).forEach(([golink, destination]) => {
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`));
      row.appendChild(cell(destination));

      const deleteCell = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "❌";
      deleteBtn.style.border = "none";
      deleteBtn.style.background = "transparent";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.title = "Delete link";

      deleteBtn.addEventListener("click", async () => {
        const updatedLinks = { ...links };
        delete updatedLinks[golink];
        await browser.storage.sync.set({ localLinks: updatedLinks });
        populateUserLinksWithForm(updatedLinks);
      });

      deleteCell.appendChild(deleteBtn);
      row.appendChild(deleteCell);
      table.appendChild(row);
    });

    const formRow = document.createElement("tr");
    const nameCell = document.createElement("td");
    const urlCell = document.createElement("td");
    const addCell = document.createElement("td");

    nameCell.innerHTML =
      '<input type="text" id="link-name" placeholder="go/newlink" required>';
    urlCell.innerHTML =
      '<input type="text" id="link-url" placeholder="https://example.com" required>';

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add";
    addBtn.type = "submit";
    addBtn.id = "add-btn";
    addCell.appendChild(addBtn);

    formRow.appendChild(nameCell);
    formRow.appendChild(urlCell);
    formRow.appendChild(addCell);
    table.appendChild(formRow);

    document
      .getElementById("add-link-form")
      .addEventListener("submit", async (e) => {
        e.preventDefault();

        const linkName = document
          .getElementById("link-name")
          .value.trim()
          .replace(/^go\//, "");
        const linkUrl = document.getElementById("link-url").value.trim();

        if (linkName && linkUrl) {
          const updatedLocalLinks = { ...links, [linkName]: linkUrl };
          await browser.storage.sync.set({ localLinks: updatedLocalLinks });
          populateUserLinksWithForm(updatedLocalLinks);
        }
      });
  }

  populateUserLinksWithForm(localLinks);
  populateTable("default-links", defaultLinks);
})();
