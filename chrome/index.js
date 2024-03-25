function cell(text) {
  const cell = document.createElement("td");
  const cellText = document.createTextNode(text);
  cell.appendChild(cellText);
  return cell;
}

async function loadTable() {
  console.debug("loadTable");
  const links = await getLinks();

  const table = document.getElementById("links");
  table.innerHTML = "";

  Object.entries(links).forEach(([golink, destination]) => {
    const row = document.createElement("tr");
    row.appendChild(cell(`go/${golink}`));
    row.appendChild(cell(destination));
    table.appendChild(row);
  });
}

const refresh = document.getElementById("refresh");
refresh.onclick = async function () {
  console.debug("refresh onClick");
  loadTable();
};

void loadTable();
