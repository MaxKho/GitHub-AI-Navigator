import weaviate, { generative, vectors } from 'weaviate-client';

const weaviateURL = process.env.WEAVIATE_URL ?? "uswoznthqgmtnw7yj70kwg.c0.europe-west3.gcp.weaviate.cloud";
const weaviateApiKey = process.env.WEAVIATE_API_KEY ?? "Q2NrVUJJeloyRHNGcWh0d19MMHRTeTVKbkJnM2l1SnFKNnA1U09WOG9iYXUvSGtlMjlyUVZTeVVjWnlZPV92MjAw";

// Best practice: store your credentials as environment variables
// WEAVIATE_URL       your Weaviate instance URL
// WEAVIATE_API_KEY   your Weaviate instance API Key

const client = await weaviate.connectToWeaviateCloud(weaviateURL,
  {
    authCredentials: new weaviate.ApiKey(weaviateApiKey),
  }
)

if (!client.collections.get("Summaries")) {
  await client.collections.create({
    name: "Summaries",
    vectorizers: vectors.text2VecOpenAI(),
    generative: generative.cohere()
  })
}

export async function importSummaries() {
  const summaries = client.collections.use('Summaries')
  const result = await summaries.data.insertMany().catch(
    (e) => {
      console.error(e)
    })
}

client.close()
