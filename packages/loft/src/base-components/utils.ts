export function isJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

export function createSortableFileNameWithDate(fileName: string) {
  // Get the current date
  const now = new Date();

  // Format the date in ISO 8601 format without milliseconds
  const formattedDate = now.toISOString().split('.')[0];

  // Concatenate the formatted date with the file name
  const sortableFileName = `${formattedDate}_${fileName}`;

  return sortableFileName;
}

// Function to extract filename from a given path
export function extractFileName(filePath: string) {
  const fileName = filePath.split('/').pop();
  if (!fileName) {
    throw new Error('Invalid file path, no file name found');
  }
  return fileName;
}

// Function to extract directory path from a given path
export function extractDirectoryPath(filePath: string) {
  return filePath.substring(0, filePath.lastIndexOf('/'));
}

// Function to create a new path with a sortable filename
export function createNewPathWithSortableFileName(filePath: string) {
  const fileName = extractFileName(filePath);
  const sortableFileName = createSortableFileNameWithDate(fileName);
  const directoryPath = extractDirectoryPath(filePath);
  const newPath = `${directoryPath}/${sortableFileName}`;

  return newPath;
}
