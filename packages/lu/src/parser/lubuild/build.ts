/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {LuBuildCore} from './core'
import {Settings} from './settings'
import {MultiLanguageRecognizer} from './multi-language-recognizer'
import {Recognizer} from './recognizer'
const path = require('path')
const fs = require('fs-extra')
const delay = require('delay')
const fileHelper = require('./../../utils/filehelper')
const fileExtEnum = require('./../utils/helpers').FileExtTypeEnum
const LuisBuilder = require('./../luis/luisBuilder')
const Content = require('./../lu/lu')

export class Builder {
  private readonly logger: any

  constructor(logger: any) {
    this.logger = logger
  }

  async build(flags: any) {
    if (!flags.stdin && !flags.in) {
      throw new Error('Missing input. Please use stdin or pass a file or folder location with --in flag')
    }

    flags.culture = flags.culture && flags.culture !== '' ? flags.culture : 'en-us'
    flags.region = flags.region && flags.region !== '' ? flags.region : 'westus'
    flags.suffix = flags.suffix && flags.suffix !== '' ? flags.suffix : 'development'
    flags.fallbackLocale = flags.fallbackLocale && flags.fallbackLocale !== '' ? flags.fallbackLocale : 'en-us'

    let multiRecognizers = new Map<string, MultiLanguageRecognizer>()
    let settings: Settings
    let recognizers: Recognizer[] = []
    let luContents: Array<any> = []
    let dialogFilePath = process.cwd()

    // luis api TPS which means 5 concurrent transactions to luis api in 1 second
    // can set to other value if switched to a higher TPS(transaction per second) key
    let luisApiTps = 5

    // set luis call delay duration to 1100 millisecond because 1000 can hit corner case of rate limit
    let delayDuration = 1100

    if (flags.stdin && flags.stdin !== '') {
      this.logger.log('Load lu content from stdin')
      luContents.push(new Content(flags.stdin, 'stdin', true, flags.culture, path.join(process.cwd(), 'stdin')))
      multiRecognizers.set('stdin', new MultiLanguageRecognizer(path.join(process.cwd(), 'stdin.lu.dialog'), {}))
      settings = new Settings(path.join(process.cwd(), `luis.settings.${flags.suffix}.${flags.region}.json`), {})
    } else {
      this.logger.log('Start to load lu files\n')
      dialogFilePath = flags.in.endsWith(fileExtEnum.LUFile) ? path.dirname(path.resolve(flags.in)) : path.resolve(flags.in)
      let files = await fileHelper.getLuFiles(flags.in, true, fileExtEnum.LUFile)
      for (const file of files) {
        let fileCulture: string
        let fileName: string
        const luFiles = await fileHelper.getLuObjects(undefined, file, true, fileExtEnum.LUFile)
        const result = await LuisBuilder.build(luFiles, true, flags.culture)
        const fileContent = result.parseToLuContent()
        this.logger.log(`${file} loaded\n`)
        let cultureFromPath = fileHelper.getCultureFromPath(file)
        if (cultureFromPath) {
          fileCulture = cultureFromPath
          let fileNameWithCulture = path.basename(file, path.extname(file))
          fileName = fileNameWithCulture.substring(0, fileNameWithCulture.length - fileCulture.length - 1)
        } else {
          fileCulture = flags.culture
          fileName = path.basename(file, path.extname(file))
        }

        const multiRecognizerPath = path.join(dialogFilePath, `${fileName}.lu.dialog`)
        if (!multiRecognizers.has(fileName)) {
          let multiRecognizerContent = {}
          if (fs.existsSync(multiRecognizerPath)) {
            multiRecognizerContent = JSON.parse(await fileHelper.getContentFromFile(multiRecognizerPath)).recognizers
            this.logger.log(`${multiRecognizerPath} loaded\n`)
          }

          multiRecognizers.set(fileName, new MultiLanguageRecognizer(multiRecognizerPath, multiRecognizerContent))
        }

        luContents.push(new Content(fileContent, fileName, true, fileCulture, file))
      }

      let settingsPath = path.join(dialogFilePath, `luis.settings.${flags.suffix}.${flags.region}.json`)
      let settingsContent: any = {}
      if (fs.existsSync(settingsPath)) {
        settingsContent = JSON.parse(await fileHelper.getContentFromFile(settingsPath)).luis
        this.logger.log(`${settingsPath} loaded\n`)
      }

      settings = new Settings(settingsPath, settingsContent)
    }

    // validate if there are duplicated files with same name and locale
    let setOfContents = new Set()
    const hasDuplicates = luContents.some(function (currentObj) {
      return setOfContents.size === setOfContents.add(currentObj.name).size
    })

    if (hasDuplicates) {
      throw new Error('Files with same name and locale are found.')
    }

    this.logger.log('Start to handle applications\n')
    const defaultLuisSchemeVersion = '4.0.0'
    const luBuildCore = new LuBuildCore(flags.authoringKey, `https://${flags.region}.api.cognitive.microsoft.com`)
    const apps = await luBuildCore.GetApplicationList()

    // here we do a while loop to make full use of luis tps capacity
    while (luContents.length > 0) {
      // get a number(set by luisApiTps) of contents for each loop
      const subLuContents = luContents.splice(0, luisApiTps)

      // concurrently handle applications
      await Promise.all(subLuContents.map(async content => {
        // init current application object from lu content
        let currentApp = await this.InitApplicationFromLuContent(content, flags, defaultLuisSchemeVersion)

        // init recogizer of current app
        let dialogFile = path.join(dialogFilePath, `${content.name}.dialog`)

        let existingDialogObj: any
        if (fs.existsSync(dialogFile)) {
          existingDialogObj = JSON.parse(await fileHelper.getContentFromFile(dialogFile))
          this.logger.log(`${dialogFile} loaded\n`)
        }

        let recognizer = Recognizer.load(content.path, content.name, dialogFile, settings, existingDialogObj)

        // find if there is a matched name with current app under current authoring key
        if (!recognizer.getAppId()) {
          for (let app of apps) {
            if (app.name === currentApp.name) {
              recognizer.setAppId(app.id)
              break
            }
          }
        }

        let needTrainAndPublish = false

        // compare models to update the model if a match found
        // otherwise create a new application
        if (recognizer.getAppId() && recognizer.getAppId() !== '') {
          // To see if need update the model
          needTrainAndPublish = await this.UpdateApplication(currentApp, luBuildCore, recognizer, delayDuration)
        } else {
          // create a new application
          needTrainAndPublish = await this.CreateApplication(currentApp, luBuildCore, recognizer, delayDuration)
        }

        if (needTrainAndPublish) {
          // train and publish application
          await this.TrainAndPublishApplication(luBuildCore, recognizer, delayDuration)
        }

        // save dialog assets
        // save multiLanguageRecognizer assert
        if (multiRecognizers.has(content.id)) {
          let multiRecognizer = multiRecognizers.get(content.id) as MultiLanguageRecognizer
          multiRecognizer.recognizers[currentApp.culture] = path.basename(dialogFile, '.dialog')
          if (currentApp.culture.toLowerCase() === flags.fallbackLocale.toLowerCase()) {
            multiRecognizer.recognizers[''] = path.basename(dialogFile, '.dialog')
          }
        }

        // save settings assert
        settings.luis[content.name.split('.').join('_')] = recognizer.getAppId()

        // save recognizers assert
        recognizers.push(recognizer)
      }))
    }

    // write dialog assets
    const contents = luBuildCore.GenerateDeclarativeAssets(recognizers, Array.from(multiRecognizers.values()), settings)
    if (flags.dialog) {
      for (const content of contents) {
        if (flags.out) {
          const outFilePath = path.join(path.resolve(flags.out), path.basename(content.path))
          if (flags.force || !fs.existsSync(outFilePath)) {
            this.logger.log(`Writing to ${outFilePath}\n`)
            await fs.writeFile(outFilePath, content.content, 'utf-8')
          }
        } else {
          if (flags.force || !fs.existsSync(content.path)) {
            this.logger.log(`Writing to ${content.path}\n`)
            await fs.writeFile(content.path, content.content, 'utf-8')
          }
        }
      }
    } else {
      if (contents.length > 0) {
        this.logger.log('The published application ids:')
        this.logger.log(JSON.parse(contents[contents.length - 1].content).luis)
        this.logger.log('\n')
      }
    }

    this.logger.log('All tasks done\n')
  }

  async InitApplicationFromLuContent(content: any, flags: any, defaultLuisSchemeVersion: string) {
    let currentApp = await content.parseToLuis(true, content.language)
    currentApp.culture = currentApp.culture && currentApp.culture !== '' ? currentApp.culture : content.language as string
    currentApp.luis_schema_version = currentApp.luis_schema_version && currentApp.luis_schema_version !== '' ? currentApp.luis_schema_version : defaultLuisSchemeVersion
    currentApp.desc = currentApp.desc && currentApp.desc !== '' ? currentApp.desc : `Model for ${flags.botName} app, targetting ${flags.suffix}`

    if (currentApp.name === undefined || currentApp.name === '') {
      currentApp.name = `${flags.botName}(${flags.suffix})-${content.name}`
    }

    return currentApp
  }

  async UpdateApplication(currentApp: any, luBuildCore: LuBuildCore, recognizer: Recognizer, delayDuration: number) {
    await delay(delayDuration)
    const appInfo = await luBuildCore.GetApplicationInfo(recognizer.getAppId())
    recognizer.versionId = appInfo.activeVersion

    await delay(delayDuration)
    const existingApp = await luBuildCore.ExportApplication(recognizer.getAppId(), recognizer.versionId)

    // compare models
    const needUpdate = luBuildCore.CompareApplications(currentApp, existingApp)
    if (needUpdate) {
      const newVersionId = luBuildCore.UpdateVersion(currentApp, existingApp)
      recognizer.versionId = newVersionId
      const options: any = {
        versionId: newVersionId
      }

      this.logger.log(`${recognizer.getLuPath()} creating version=${newVersionId}\n`)
      await delay(delayDuration)
      await luBuildCore.ImportNewVersion(recognizer.getAppId(), currentApp, options)
      return true
    } else {
      this.logger.log(`${recognizer.getLuPath()} no changes\n`)
      return false
    }
  }

  async CreateApplication(currentApp: any, luBuildCore: LuBuildCore, recognizer: Recognizer, delayDuration: number) {
    currentApp.versionId = currentApp.versionId && currentApp.versionId !== '' ? currentApp.versionId : '0.1'
    recognizer.versionId = currentApp.versionId
    this.logger.log(`Creating LUIS.ai application: ${currentApp.name} version:${currentApp.versionId}\n`)
    await delay(delayDuration)
    const response = await luBuildCore.ImportApplication(currentApp)
    recognizer.setAppId(typeof response.body === 'string' ? response.body : response.body[Object.keys(response.body)[0]])
    return true
  }

  async TrainAndPublishApplication(luBuildCore: LuBuildCore, recognizer: Recognizer, delayDuration: number) {
    // send train application request
    this.logger.log(`${recognizer.getLuPath()} training version=${recognizer.versionId}\n`)
    await delay(delayDuration)
    await luBuildCore.TrainApplication(recognizer.getAppId(), recognizer.versionId)
    this.logger.log(`${recognizer.getLuPath()} waiting for training for version=${recognizer.versionId}...`)
    let done = true
    do {
      await delay(delayDuration)

      // get training status to see if training completed
      let trainingStatus = await luBuildCore.GetTrainingStatus(recognizer.getAppId(), recognizer.versionId)
      done = true
      for (let status of trainingStatus) {
        if (status.details) {
          if (status.details.status === 'InProgress' || status.details.status === 'Queued') {
            done = false
            break
          }
        }
      }
    } while (!done)
    this.logger.log('done\n')

    // publish applications
    this.logger.log(`${recognizer.getLuPath()} publishing version=${recognizer.versionId}\n`)
    await delay(delayDuration)
    await luBuildCore.PublishApplication(recognizer.getAppId(), recognizer.versionId)
    this.logger.log(`${recognizer.getLuPath()} publishing finished\n`)
  }
}
