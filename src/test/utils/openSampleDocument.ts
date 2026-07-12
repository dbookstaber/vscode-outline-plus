import { readdirSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";

export async function openValidSampleDocument(fileName: string): Promise<vscode.TextDocument> {
  return openSampleDocument("validSamples", fileName);
}

export async function openInvalidSampleDocument(fileName: string): Promise<vscode.TextDocument> {
  return openSampleDocument("invalidSamples", fileName);
}

export async function openSampleDocument(
  ...filePathWithinSamplesDir: string[]
): Promise<vscode.TextDocument> {
  const sampleFilePath = getFullSamplesPath(...filePathWithinSamplesDir);
  return await openDocumentAtPath(sampleFilePath);
}

export async function openAllFilesInSampleFolder(
  ...folderPathWithinSamplesDir: string[]
): Promise<vscode.TextDocument[]> {
  const sampleFolderPath = getFullSamplesPath(...folderPathWithinSamplesDir);
  return await openAllFilesInDir(sampleFolderPath);
}

function getFullSamplesPath(...pathWithinSamplesDir: string[]): string {
  // webpack.test.config.ts flattens every test bundle to dist-tests/<name>.js,
  // and copy-webpack-plugin places the fixtures at dist-tests/samples. So every
  // compiled test sits one level above the samples folder: __dirname is always
  // dist-tests, and the samples are a direct child.
  return path.join(__dirname, "samples", ...pathWithinSamplesDir);
}

export async function openAllFilesInDir(dirPath: string): Promise<vscode.TextDocument[]> {
  const filesNames = readdirSync(dirPath);
  const filePaths = filesNames.map((fileName) => path.join(dirPath, fileName));
  return Promise.all(filePaths.map(openDocumentAtPath));
}

export function getAllFileNamesInSampleFolder(...folderPathWithinSamplesDir: string[]): string[] {
  const sampleFolderPath = getFullSamplesPath(...folderPathWithinSamplesDir);
  return readdirSync(sampleFolderPath);
}

export async function openDocumentAtPath(filePath: string): Promise<vscode.TextDocument> {
  return await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
}
