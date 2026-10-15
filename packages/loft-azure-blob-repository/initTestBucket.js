const { BlobServiceClient } = require('@azure/storage-blob');

async function initContainer() {
  const containerName = process.env.AZURE_BLOB_STORAGE_CONTAINER_NAME;

  const blobServiceClient = BlobServiceClient.fromConnectionString('UseDevelopmentStorage=true');

  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const containerExists = await containerClient.exists();

    if (containerExists) {
      console.log(`Container "${containerName}" found!`);

      return;
    }

    await blobServiceClient.createContainer(containerName);

    console.log(`Container "${containerName}" created!`);
  } catch (error) {
    console.error('Error:', error);
  }
}

initContainer();
