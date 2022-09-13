import * as path from "path"
import fs from "fs"
import inquirer from "inquirer"

import { Files } from "../types"
import { getCairoPathsForNile, getCairoPathsForProtostar } from "../tools"

const IMPORT_REGEX = /^from\s(.*?)\simport/gm
const ui = new inquirer.ui.BottomBar();


export async function getFileTree(mainFilePath: string): Promise<Files> {
  try {
    const cairoPaths = await getCairoPathsForProtostar()
    const files = await FileTree.getFiles({
      mainFilePath: mainFilePath,
      shouldPromptUser: false,
      cairoPaths: cairoPaths,
    })
    return files
  } catch (err) {
    ui.log.write("cannot get files from default protostar")
  }

  try {
    const cairoPaths = await getCairoPathsForNile()
    const files = await FileTree.getFiles({
      mainFilePath: mainFilePath,
      shouldPromptUser: false,
      cairoPaths: cairoPaths,
    })
    return files
  } catch (err) {
    ui.log.write("cannot get files from default nile")
  }

  // start search
  const files = await FileTree.getFiles({
    mainFilePath: mainFilePath,
    shouldPromptUser: true,
    cairoPaths: [],
  })
  return files
}

class FileTree {
  // should ask user for cairo path if cannot be found, will throw otherwise
  shouldPromptUser: boolean
  
  mainFilePathName: string
  files: Files
  cairoPaths: string[]

  static async getFiles({
    mainFilePath,
    shouldPromptUser,
    cairoPaths,
  } : {
    mainFilePath: string
    shouldPromptUser: boolean
    cairoPaths: string[]
  }): Promise<Files> {
    const fileTree = new FileTree({
      mainFilePath: mainFilePath,
      shouldPromptUser: shouldPromptUser,
      cairoPaths: cairoPaths,
    })
    await fileTree.populateFileTree()
    return fileTree.files
  }

  constructor({
    mainFilePath,
    shouldPromptUser,
    cairoPaths,
  } : {
    mainFilePath: string
    shouldPromptUser: boolean
    cairoPaths: string[]
  }) {
    this.shouldPromptUser = shouldPromptUser
    this.mainFilePathName = path.basename(mainFilePath)
    this.files = {}
    this.cairoPaths = [path.dirname(mainFilePath), ...cairoPaths]
  }

  async populateFileTree() {
    await this._populateFileTree(this.mainFilePathName)
    return this.files
  }

  private async _populateFileTree(currentFilePath: string) {
    if (currentFilePath in this.files) {
      // this file path has already been found
      return this.files;
    }

    // search for contents
    const fileContents = await this.getFileContents(currentFilePath)

    // save the file
    this.files[currentFilePath] = fileContents

    // get all imported files
    const importedFilesRegexOutput = [...fileContents.matchAll(IMPORT_REGEX)]
    const importedFilesPath = importedFilesRegexOutput.map(importedFileRegex => {
      return importedFileRegex[1]
    })

    // process each imported file
    for (let i = 0; i < importedFilesPath.length; i++) {
      const importedFilePath = importedFilesPath[i]
      if (importedFilePath.startsWith("starkware")) {
        // ignore starkware packages, should be included in cairo-lang
        continue
      }
      const convertedFilePath = importedFilePath.split(".").join("/") + ".cairo"
      await this._populateFileTree(convertedFilePath)
    }
  }

  private async getFileContents(currentFilePath: string) {
    // search base file
    const fileExists = fs.existsSync(currentFilePath)
    if (fileExists) {
      ui.log.write(`FOUND FILE!: ${currentFilePath}`)
      return fs.readFileSync(currentFilePath, "utf-8")
    }

    // search in potential paths
    for (let i = 0; i < this.cairoPaths.length; i++) {
      const searchPath = this.cairoPaths[i]
      ui.log.write(`searching in ${searchPath}`)
      const potentialFullFilePath = path.join(searchPath, currentFilePath)
      const fileExists = fs.existsSync(potentialFullFilePath)
      if (fileExists) {
        ui.log.write(`FOUND FILE!: ${potentialFullFilePath}`)
        return fs.readFileSync(potentialFullFilePath, "utf-8")
      }
    }

    // cannot find file
    if (this.shouldPromptUser) {
      while(true) {
        // loop until file is found
        ui.log.write(`Could not find file: ${currentFilePath}, searched in ${this.cairoPaths}`)
        const baseItem = currentFilePath.split(path.sep)[0]
        const userInput = await inquirer.prompt(
          {
            type: "input",
            name: "CairoPath",
            message: `Please provide the parent directory to ${baseItem}`,
          },
        )
        const potentialNewCairoPath = userInput.CairoPath
        const potentialFullFilePath = path.join(potentialNewCairoPath, currentFilePath)
        if (fs.existsSync(potentialFullFilePath)) {
          this.cairoPaths.push(potentialNewCairoPath)
          ui.log.write(`FOUND FILE!: ${potentialFullFilePath}`)
          return fs.readFileSync(potentialFullFilePath, "utf-8")
        }
        // cannot find... continue looping
      }
    } else {
      throw new Error(`Could not find file: ${currentFilePath}`)
    }
  }
}

