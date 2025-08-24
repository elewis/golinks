// Firefox uses browser API directly

(async () => {
  const links = await getLinks();

  const table = document.getElementById("links");
  table.innerHTML = "";

  function cell(text) {
    const cell = document.createElement("td");
    const cellText = document.createTextNode(text);
    cell.appendChild(cellText);
    return cell;
  }

  Object.entries(links).forEach(([golink, destination]) => {
    const row = document.createElement("tr");
    row.appendChild(cell(`go/${golink}`));
    row.appendChild(cell(destination));
    table.appendChild(row);
  });
})();