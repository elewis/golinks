async function getConfig() {
  return {
    linksUrl: "http://localhost:8000/links.json"
  }
}

async function setConfig(config) {

}

async function getLinks() {
  console.debug("getLinks");
  const config = await getConfig();
  const linksJson = await fetch(config.linksUrl).then((response) => response.json());
  return linksJson["links"];
}
