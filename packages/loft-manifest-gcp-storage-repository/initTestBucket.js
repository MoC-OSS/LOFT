const { Storage } = require('@google-cloud/storage');

async function initBucket() {
  const bucketName = process.env.GCP_BUCKET;

  const storage = new Storage({
    apiEndpoint: process.env.GCP_API_ENDPOINT,
    projectId: process.env.GCP_API_PROJECT_ID
  });

  try {
    const [buckets] = await storage.getBuckets();

    const foundBucket = buckets.find(({ name }) => name === bucketName);

    if (foundBucket) {
      console.log(`Bucket "${bucketName}" found!`);

      return;
    }

    await storage.createBucket(bucketName);

    console.log(`Bucket "${bucketName}" created!`);
  } catch (error) {
    console.error('Error:', error);
  }
}

initBucket();
