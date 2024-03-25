async function getLinks() {
  const linksJson = await fetch('./links.json').then((response) => response.json());
  return linksJson["links"];
}
