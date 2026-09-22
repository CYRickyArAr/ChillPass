import type { Language } from '@stores/languageStore'
import { progressZh, progressEn } from './progress'

export type TranslationKey =
  | keyof typeof progressZh
  | 'search.placeholder'
  | 'search.noResults'
  | 'search.resultMeta'
  | 'search.matchLabel'
  | 'search.clear'
  | 'nav.dashboard'
  | 'nav.upload'
  | 'nav.lessons'
  | 'nav.wrongbook'
  | 'nav.chat'
  | 'nav.settings'
  | 'nav.levelUnit'
  | 'nav.generating'
  | 'settings.title'
  | 'settings.subtitle'
  | 'settings.appDesc'
  | 'settings.statsCourses'
  | 'settings.statsFiles'
  | 'settings.localInfo'
  | 'settings.localInfoDesc'
  | 'settings.localDataTitle'
  | 'settings.localDataDesc'
  | 'settings.teacher'
  | 'settings.teacherDesc'
  | 'settings.teacherToggle'
  | 'settings.teacherOn'
  | 'settings.teacherOff'
  | 'settings.api'
  | 'settings.apiDesc'
  | 'settings.storage'
  | 'settings.storageDesc'
  | 'settings.data'
  | 'settings.dataDesc'
  | 'settings.about'
  | 'settings.aboutDesc'
  | 'settings.appearance'
  | 'settings.appearanceDesc'
  | 'settings.language'
  | 'settings.theme'
  | 'settings.themeLight'
  | 'settings.themeDark'
  | 'settings.uiFontSize'
  | 'settings.uiFontSizeDesc'
  | 'settings.uiFontSizeReset'
  | 'settings.applied'
  | 'settings.applyLanguage'
  | 'about.subtitle'
  | 'about.appInfo'
  | 'about.appName'
  | 'about.backToSettings'
  | 'about.joinUs'
  | 'about.joinUsDesc'
  | 'about.wechat'
  | 'about.copy'
  | 'about.copied'
  | 'titlebar.balance'
  | 'titlebar.balanceQuery'
  | 'titlebar.balanceLoading'
  | 'titlebar.balanceUnavailable'
  | 'titlebar.balanceRefresh'
  | 'titlebar.balanceNoKey'
  | 'titlebar.balanceUnsupported'
  | 'titlebar.providerSwitch'
  | 'titlebar.focusMode'
  | 'titlebar.exitFocus'
  | 'common.back'
  | 'common.save'
  | 'common.saved'
  | 'common.cancel'
  | 'common.confirm'
  | 'titlebar.minimize'
  | 'titlebar.close'
  | 'dashboard.welcome'
  | 'dashboard.noCourse'
  | 'dashboard.noCourseDesc'
  | 'dashboard.importBtn'
  | 'dashboard.countdown'
  | 'dashboard.daysLeft'
  | 'dashboard.examToday'
  | 'dashboard.setExamDate'
  | 'dashboard.progress'
  | 'dashboard.quickAsk'
  | 'dashboard.quickImport'
  | 'dashboard.quickQuest'
  | 'upload.title'
  | 'upload.subtitle'
  | 'upload.courseName'
  | 'upload.courseNamePlaceholder'
  | 'upload.examDate'
  | 'upload.selectFiles'
  | 'upload.dragHere'
  | 'upload.modeCreate'
  | 'upload.modeAppend'
  | 'upload.start'
  | 'upload.importing'
  | 'lessons.title'
  | 'lesson.keyPoints'
  | 'lesson.examples'
  | 'lesson.quiz'
  | 'lesson.complete'
  | 'lesson.nextPage'
  | 'lesson.finish'
  | 'lesson.retry'
  | 'lesson.changeQuestion'
  | 'lesson.submit'
  | 'lesson.correctAnswer'
  | 'lesson.standardAnswer'
  | 'lesson.showAnswer'
  | 'lesson.hideAnswer'
  | 'lesson.answerViewed'
  | 'lesson.answerViewHint'
  | 'lesson.referenceUnavailable'
  | 'wrongbook.title'
  | 'wrongbook.empty'
  | 'wrongbook.yourAnswer'
  | 'wrongbook.correctAnswer'
  | 'wrongbook.askAthena'
  | 'wrongbook.mastered'
  | 'wrongbook.clear'
  | 'athena.title'
  | 'athena.subtitle'
  | 'athena.thinking'
  | 'athena.basedOn'
  | 'athena.idle'
  | 'athena.tasking'
  | 'athena.abilities'
  | 'athena.memories'
  | 'athena.taskQa'
  | 'athena.taskPaper'
  | 'athena.taskReport'
  | 'athena.taskSummary'
  | 'athena.taskPlan'
  | 'athena.taskQaDesc'
  | 'athena.taskPaperDesc'
  | 'athena.taskReportDesc'
  | 'athena.taskSummaryDesc'
  | 'athena.taskPlanDesc'
  | 'athena.startTask'
  | 'athena.inputPlaceholder'
  | 'athena.charterMemory'
  | 'athena.flowMemory'
  | 'athena.export'
  | 'athena.import'
  | 'onboarding.welcomeTitle'
  | 'onboarding.welcomeSubtitle'
  | 'onboarding.privacyNote'
  | 'onboarding.languageLabel'
  | 'onboarding.overviewTitle'
  | 'onboarding.step1Title'
  | 'onboarding.step1Desc'
  | 'onboarding.step2Title'
  | 'onboarding.step2Desc'
  | 'onboarding.step3Title'
  | 'onboarding.step3Desc'
  | 'onboarding.startTitle'
  | 'onboarding.startDesc'
  | 'onboarding.goConfig'
  | 'onboarding.prev'
  | 'onboarding.next'
  | 'onboarding.skip'
  | 'settings.reviewGuide'
  | 'settings.reviewGuideDesc'
  | 'tokens.title'
  | 'tokens.desc'
  | 'tokens.total'
  | 'tokens.today'
  | 'tokens.calls'
  | 'tokens.prompt'
  | 'tokens.completion'
  | 'tokens.last7'
  | 'tokens.reset'
  | 'tokens.resetConfirm'
  | 'tokens.empty'

  | 'dashboard.badge'
  | 'dashboard.heroTitle'
  | 'dashboard.heroSubtitle'
  | 'dashboard.stepExtract'
  | 'dashboard.stepQuest'
  | 'dashboard.statusEmpty'
  | 'dashboard.statusUploaded'
  | 'dashboard.statusAnalyzing'
  | 'dashboard.statusReady'
  | 'dashboard.priorityMust'
  | 'dashboard.priorityHigh'
  | 'dashboard.priorityKnow'
  | 'dashboard.deleteConfirm'
  | 'dashboard.importFailedFormat'
  | 'dashboard.importSuccess'
  | 'dashboard.importDuplicate'
  | 'dashboard.importFailedParse'
  | 'dashboard.importFailedRead'
  | 'dashboard.renameCourse'
  | 'dashboard.exportCourse'
  | 'dashboard.deleteCourse'
  | 'dashboard.newCourse'
  | 'dashboard.importCourseTip'
  | 'dashboard.importCourse'
  | 'dashboard.streak'
  | 'dashboard.dateFormat'
  | 'dashboard.preparing'
  | 'dashboard.preparingEmpty'
  | 'dashboard.preparingUploaded'
  | 'dashboard.preparingAnalyzing'
  | 'dashboard.preparationPaused'
  | 'dashboard.preparingNeedsParsing'
  | 'dashboard.preparingParsing'
  | 'dashboard.preparingParsingProgress'
  | 'dashboard.preparingBuilding'
  | 'dashboard.preparationProgress'
  | 'dashboard.stageParse'
  | 'dashboard.stageExtract'
  | 'dashboard.stageBuild'
  | 'dashboard.retryPreparation'
  | 'dashboard.continuePreparation'
  | 'dashboard.backToImport'
  | 'dashboard.genBanner'
  | 'dashboard.cancelGeneration'
  | 'dashboard.resumeGeneration'
  | 'dashboard.generationPaused'
  | 'dashboard.untilExam'
  | 'dashboard.editDate'
  | 'dashboard.edit'
  | 'dashboard.dayUnit'
  | 'dashboard.sprintFinal'
  | 'dashboard.examOngoing'
  | 'dashboard.examDateLabel'
  | 'dashboard.examEnded'
  | 'dashboard.examEndedDays'
  | 'dashboard.examStats'
  | 'dashboard.totalPoints'
  | 'dashboard.quickEntries'
  | 'dashboard.continueStudy'

  | 'upload.pageSubtitle'
  | 'upload.stEmpty'
  | 'upload.stUploaded'
  | 'upload.stAnalyzing'
  | 'upload.stReady'
  | 'upload.errPickFile'
  | 'upload.errNameRequired'
  | 'upload.errFilesRequired'
  | 'upload.parsing'
  | 'upload.errDuplicateName'
  | 'upload.parsingFile'
  | 'upload.extracting'
  | 'upload.doneJump'
  | 'upload.parseFailed'
  | 'upload.errSelectCourse'
  | 'upload.errCourseMissing'
  | 'upload.errOptimizationBusy'
  | 'upload.parsingAppend'
  | 'upload.allSkipped'
  | 'upload.extractingAppend'
  | 'upload.newFilesCount'
  | 'upload.merging'
  | 'upload.appendDone'
  | 'upload.processing'
  | 'upload.startAppend'
  | 'upload.modeAppendFull'
  | 'upload.appendTip'
  | 'upload.noExisting'
  | 'upload.appendModeHint'
  | 'upload.courseNameExample'
  | 'upload.selectExisting'
  | 'upload.selectedInfo'
  | 'upload.dropAppend'
  | 'upload.dropCreate'
  | 'upload.dropzoneHint'
  | 'upload.removeFile'
  | 'upload.goConfig'
  | 'upload.skipped'
  | 'upload.scanCourseFolder'
  | 'upload.openCourseFolder'
  | 'upload.noNewFolderFiles'
  | 'upload.courseFolderReady'
  | 'upload.stepParse'
  | 'upload.stepPath'

  | 'titlebar.restore'
  | 'titlebar.maximize'
  | 'titlebar.help'
  | 'titlebar.helpTitle'
  | 'titlebar.helpIntroTitle'
  | 'titlebar.helpIntroBody'
  | 'titlebar.helpQuickTitle'
  | 'titlebar.helpItem1T'
  | 'titlebar.helpItem1D'
  | 'titlebar.helpItem2T'
  | 'titlebar.helpItem2D'
  | 'titlebar.helpItem3T'
  | 'titlebar.helpItem3D'
  | 'titlebar.helpItem4T'
  | 'titlebar.helpItem4D'
  | 'titlebar.helpItem5T'
  | 'titlebar.helpItem5D'
  | 'titlebar.helpItem6T'
  | 'titlebar.helpItem6D'
  | 'titlebar.helpItem7T'
  | 'titlebar.helpItem7D'
  | 'titlebar.helpItem8T'
  | 'titlebar.helpItem8D'
  | 'titlebar.helpItem10T'
  | 'titlebar.helpItem10D'
  | 'titlebar.helpContactTitle'
  | 'titlebar.helpWechat'
  | 'titlebar.helpVersionLabel'
  | 'titlebar.helpVersionValue'
  | 'titlebar.helpQrText'
  | 'titlebar.helpGotIt'
  | 'sidebar.workspace'

  | 'lessons.defaultGroup'
  | 'lessons.emptyTitle'
  | 'lessons.emptyDesc'
  | 'lessons.goImport'
  | 'lessons.groupProgress'
  | 'lessons.statusDone'
  | 'lessons.statusLocked'
  | 'lessons.tapStart'
  | 'lessons.batchRegenerate'
  | 'lessons.batchConfirmTitle'
  | 'lessons.batchConfirmDesc'
  | 'lessons.batchStart'
  | 'lessons.batchCancel'
  | 'lessons.batchProgress'
  | 'lessons.batchScanning'
  | 'lessons.batchScanFailed'
  | 'lessons.batchResult'
  | 'lessons.batchCancelled'
  | 'lessons.batchFailed'
  | 'lessons.rebuildStructure'
  | 'lessons.rebuildConfirmTitle'
  | 'lessons.rebuildConfirmDesc'
  | 'lessons.rebuildStart'
  | 'lessons.rebuildRunning'
  | 'lessons.rebuildResult'
  | 'lessons.rebuildFailed'
  | 'lessons.clearCompleted'
  | 'lessons.clearCompletedConfirmTitle'
  | 'lessons.clearCompletedConfirmDesc'
  | 'lessons.clearCompletedStart'
  | 'lessons.clearCompletedDone'

  | 'wrongbook.clearConfirm'
  | 'wrongbook.noAnswer'
  | 'wrongbook.unknown'
  | 'wrongbook.prefillChoice'
  | 'wrongbook.prefillText'
  | 'wrongbook.subtitle'
  | 'wrongbook.keepGoing'

  | 'lesson.notFound'
  | 'lesson.backToList'
  | 'lesson.noExamPoint'
  | 'lesson.genFailedRetry'
  | 'lesson.gradeFailed'
  | 'lesson.regenerateFailed'
  | 'lesson.orderLabel'
  | 'lesson.regenerating'
  | 'lesson.tabPoints'
  | 'lesson.explanationTitle'
  | 'lesson.noExamples'
  | 'lesson.exampleN'
  | 'lesson.stepsLabel'
  | 'lesson.answerLabel'
  | 'lesson.noQuiz'
  | 'lesson.questionN'
  | 'lesson.qTypeChoice'
  | 'lesson.qTypeMulti'
  | 'lesson.qTypeFill'
  | 'lesson.qTypeShort'
  | 'lesson.yourAnswerPlaceholder'
  | 'lesson.answerCorrect'
  | 'lesson.answerWrong'
  | 'lesson.answerUngradeable'
  | 'lesson.retryGrading'
  | 'lesson.regenerateTitle'
  | 'lesson.regenerate'
  | 'lesson.regenerateContent'
  | 'lesson.regenerateContentHint'
  | 'lesson.confirmRegenerate'
  | 'lesson.restorePrevious'
  | 'lesson.regenerateSuccess'
  | 'lesson.regenerateCancelled'
  | 'lesson.restoreSuccess'
  | 'lesson.skipTitle'
  | 'lesson.skipCost'
  | 'lesson.tryAgain'
  | 'lesson.submitWithCount'
  | 'lesson.grading'
  | 'lesson.completed'
  | 'lesson.generatingWait'
  | 'lesson.genFailedManual'

  | 'teacher.qTypeCalculation'
  | 'teacher.qTypeEssay'
  | 'teacher.diffEasy'
  | 'teacher.diffMedium'
  | 'teacher.diffHard'
  | 'teacher.errPrintWindow'
  | 'teacher.errSelectCourse'
  | 'teacher.errNoCourseware'
  | 'teacher.errGenerate'
  | 'teacher.errGenerateShort'
  | 'teacher.clearConfirm'
  | 'teacher.errExportEmpty'
  | 'teacher.errTranslate'
  | 'teacher.defaultPaperTitle'
  | 'teacher.courseFallback'
  | 'teacher.title'
  | 'teacher.subtitle'
  | 'teacher.selectCourse'
  | 'teacher.selectCourseDesc'
  | 'teacher.noCourses'
  | 'teacher.charsCount'
  | 'teacher.noText'
  | 'teacher.generate'
  | 'teacher.generateDesc'
  | 'teacher.fieldQType'
  | 'teacher.fieldDifficulty'
  | 'teacher.fieldCount'
  | 'teacher.countHint'
  | 'teacher.generating'
  | 'teacher.generateBtn'
  | 'teacher.listTitle'
  | 'teacher.listSummary'
  | 'teacher.groupSummary'
  | 'teacher.pointsUnit'
  | 'teacher.labelOptions'
  | 'teacher.labelCorrect'
  | 'teacher.labelAnswer'
  | 'teacher.labelSteps'
  | 'teacher.labelAcceptable'
  | 'teacher.labelExplanation'
  | 'teacher.assemble'
  | 'teacher.assembleDesc'
  | 'teacher.assembleTranslateHint'
  | 'teacher.fieldPaperTitle'
  | 'teacher.fieldDuration'
  | 'teacher.fieldLanguage'
  | 'teacher.summaryQuestions'
  | 'teacher.summaryDuration'
  | 'teacher.translatingExport'
  | 'teacher.exportPdf'

  | 'athena.noReply'
  | 'athena.unknownError'
  | 'athena.errorPrefix'
  | 'athena.statusThinking'
  | 'athena.statusTasking'
  | 'athena.clearChat'
  | 'athena.openFullChat'
  | 'layout.showNavigation'
  | 'layout.hideNavigation'
  | 'athena.showSidebar'
  | 'athena.hideSidebar'
  | 'athena.expandPanel'
  | 'athena.restorePanel'
  | 'athena.sidebarDescription'
  | 'athena.welcomeMsg'
  | 'athena.currentTask'
  | 'athena.attachedImage'
  | 'athena.attachedFile'
  | 'athena.removeImage'
  | 'athena.insertImage'
  | 'athena.addAttachment'
  | 'athena.dropAttachments'
  | 'athena.fileTextReady'
  | 'athena.fileMetaOnly'
  | 'athena.attachmentProcessing'
  | 'athena.attachmentProcessingHint'
  | 'athena.attachmentOnlyPrompt'
  | 'athena.thinkingPlaceholder'
  | 'athena.taskInputHint'
  | 'athena.chatInputHint'
  | 'athena.send'
  | 'athena.infoCollect'
  | 'athena.unspecified'
  | 'athena.taskPromptPrefix'
  | 'athena.abilityNamePlaceholder'
  | 'athena.abilityDescPlaceholder'
  | 'athena.add'
  | 'athena.importSuccess'
  | 'athena.addCharterMemory'
  | 'athena.edit'
  | 'athena.fTopic'
  | 'athena.fTopicPh'
  | 'athena.fWords'
  | 'athena.fWordsPh'
  | 'athena.fWordsReportPh'
  | 'athena.fSpecial'
  | 'athena.fSpecialPh'
  | 'athena.fSpecialReportPh'
  | 'athena.fSummaryFocus'
  | 'athena.fSummaryFocusPh'
  | 'athena.fExamDate'
  | 'athena.fExamDatePh'
  | 'athena.fDailyTime'
  | 'athena.fDailyTimePh'
  | 'athena.fWeakAreas'
  | 'athena.fWeakAreasPh'
  | 'athena.fMastered'
  | 'athena.fMasteredPh'

  | 'athena.fLevel'
  | 'athena.fLevelPh'
  | 'athena.fReportTopic'
  | 'athena.fReportTopicPh'
  | 'athena.fReportType'
  | 'athena.fReportTypePh'
  | 'athena.fSummaryScope'
  | 'athena.fSummaryScopePh'
  | 'athena.fOutputFormat'
  | 'athena.fOutputFormatPh'

  | 'api.cardTitle'
  | 'api.cardDesc'
  | 'api.provider'
  | 'api.hintZhipu'
  | 'api.hintDeepseek'
  | 'api.hintCustom'
  | 'api.hintOpenAICompat'
  | 'api.providerCustom'
  | 'api.providerAddCustom'
  | 'api.providerDeleteCustom'
  | 'api.providerDeleteConfirm'
  | 'api.customNameLabel'
  | 'api.customNamePlaceholder'
  | 'api.customBaseUrlLabel'
  | 'api.customBaseUrlPlaceholder'
  | 'api.customBaseUrlHint'
  | 'api.customBaseUrlRequired'
  | 'api.customUsageEnabled'
  | 'api.customUsageOptionalTitle'
  | 'api.customUsageOptionalDesc'
  | 'api.customUsageHint'
  | 'api.customUsageScript'
  | 'api.customUsageReset'
  | 'api.customUsageVars'
  | 'api.keyLabel'
  | 'api.keyPhZhipu'
  | 'api.keyPhDeepseek'
  | 'api.keyPhCustom'
  | 'api.hideKey'
  | 'api.showKey'
  | 'api.keyHintZhipu'
  | 'api.keyHintDeepseek'
  | 'api.keyHintCustom'
  | 'api.linkZhipu'
  | 'api.linkDeepseek'
  | 'api.modelLabel'
  | 'api.modelHintZhipu'
  | 'api.modelHintDeepseek'
  | 'api.save'

  | 'data.title'
  | 'data.subtitle'
  | 'data.statsTitle'
  | 'data.statsDesc'
  | 'data.courseCount'
  | 'data.storageTitle'
  | 'data.storageDesc'
  | 'data.installPath'
  | 'data.loading'
  | 'data.locateTip'
  | 'data.locate'
  | 'data.userDataPath'
  | 'data.diskUsage'
  | 'data.courseDataApprox'
  | 'data.byCourse'
  | 'data.dangerTitle'
  | 'data.dangerDesc'
  | 'data.clearAll'
  | 'data.clearConfirm'
  | 'data.confirmClear'

  | 'storage.migrateFailedRetry'
  | 'storage.cardDesc'
  | 'storage.dirHint'
  | 'storage.browserDirHint'
  | 'storage.browserFilesTitle'
  | 'storage.browserFileDesc'
  | 'storage.browserToFolderTitle'
  | 'storage.browserToFolderHint'
  | 'storage.browserToFolderAction'
  | 'storage.browserAlreadyMigrated'
  | 'storage.localBackendUnavailable'
  | 'storage.gettingPath'
  | 'storage.selecting'
  | 'storage.selectDir'
  | 'storage.resetDefault'
  | 'storage.migrateDesc'
  | 'storage.noFiles'
  | 'storage.noTarget'
  | 'storage.selectTarget'
  | 'storage.moveMode'
  | 'storage.copyMode'
  | 'storage.migrateDone'
  | 'storage.migrateFailed'
  | 'storage.pathUpdated'
  | 'storage.migrating'
  | 'storage.startMigrate'

  | 'app.docTitle'
  | 'athena.memCategoryCustom'
  | 'athena.noAbilitiesHint'
  | 'athena.autoTag'
  | 'athena.charterMemoryHint'
  | 'athena.flowMemoryHint'
  | 'athena.noFlowMemoriesHint'
  | 'titlebar.helpQrAlt'
  | 'api.subtitle'
  | 'api.providerZhipu'
  | 'storage.resLocation'
  | 'storage.migration'
  | 'storage.defaultBadge'
  | 'storage.fileList'
  | 'storage.totalFiles'
  | 'storage.totalSizeLabel'
  | 'storage.filesMissing'
  | 'storage.checkingFiles'
  | 'storage.targetDir'
  | 'storage.modeLabel'
  | 'storage.modeCopy'
  | 'storage.modeMove'
  | 'storage.migratingProgress'
  | 'storage.migratedCount'
  | 'storage.migratedTotalSize'
  | 'storage.targetDirResult'
  | 'storage.firstRunTitle'
  | 'storage.firstRunDesc'
  | 'storage.firstRunDefault'
  | 'storage.firstRunUseDefault'
  | 'storage.firstRunChoose'
  | 'storage.firstRunChoosing'
  | 'account.editTitle'
  | 'account.createTitle'
  | 'account.modalSubtitle'
  | 'account.offlineHintLogin'
  | 'account.offlineHintEditor'
  | 'account.nameLabel'
  | 'account.namePlaceholder'
  | 'account.avatarLabel'
  | 'account.bioLabel'
  | 'account.bioPlaceholder'
  | 'account.nameRequired'
  | 'account.defaultName'
  | 'account.pickAvatar'
  | 'account.close'
  | 'account.createBtn'
  | 'service.noApiKey'
  | 'service.timeout'
  | 'service.network'
  | 'service.apiError'
  | 'service.retriesExhausted'
  | 'service.genLessonFailed'
  | 'service.emptyResponse'
  | 'service.structuredOutputEmpty'
  | 'service.structuredOutputTruncated'
  | 'service.structuredOutputInvalid'
  | 'service.lessonGenerationRetryFailed'
  | 'service.regenQuestionFailed'
  | 'service.answerCorrectAll'
  | 'service.answerCorrect'
  | 'service.answerPartial'
  | 'service.answerFeedbackOk'
  | 'service.answerFeedbackBad'
  | 'service.answerUngradeable'
  | 'service.fileNotFound'
  | 'service.fileKeyMissing'
  | 'parse.unsupportedFormat'
  | 'parse.apiUnavailable'
  | 'parse.docxNoXml'
  | 'parse.docxNoText'
  | 'parse.docIsRtf'
  | 'parse.docNoStream'
  | 'parse.docInvalid'
  | 'parse.docNoText'
  | 'parse.docInvalidOle'
  | 'img.apiUnavailable'
  | 'model.glmFlash'
  | 'model.glm53'
  | 'mock.dirDialogPrompt'
  | 'mock.userDataPath'
  | 'mock.closeConfirm'
  | 'mock.installPath'
  | 'mock.userDataBrowser'
  | 'mock.tempPath'
  | 'mock.installPathAlert'
  | 'mock.noReleaseNotes'
  | 'mock.updateServerUnreachable'
  | 'common.unknownError'

  | 'model.deepseekFlash'
  | 'model.deepseekV4Pro'
  | 'model.deepseekV4FlashLegacy'
  | 'model.deepseekVisionExp'
  | 'model.deepseekChatLegacy'
  | 'model.deepseekReasonerLegacy'
  | 'model.customCompatible'
  | 'model.unknownDesc'
  | 'api.modelRefresh'
  | 'api.modelRefreshing'
  | 'api.modelRefreshOk'
  | 'api.modelRefreshFailed'
  | 'api.modelNeedKey'
  | 'api.modelBuiltinHint'
  | 'api.modelLiveHint'
  | 'api.modelHoverHint'

  | 'lesson.adjudicating'
  | 'lesson.keyFixedNote'

  | 'lesson.review'
  | 'lesson.retryReview'
  | 'lesson.reviewTitle'
  | 'lesson.reviewRunning'
  | 'lesson.reviewFailed'
  | 'lesson.reviewYouWereRight'
  | 'lesson.reviewYouWereWrong'

  | 'athena.imageDirectSend'
  | 'athena.visionUnsupported'

  | 'img.invalidFormat'
  | 'img.tooLarge'

  | 'chat.svgSource'


  | 'athena.conversation'
  | 'athena.newChat'
  | 'athena.deleteChat'
  | 'athena.messageCount'

  | 'sidebar.courseManage'
  | 'sidebar.importShort'
  | 'sidebar.exportShort'
  | 'sidebar.courseSearch'
  | 'sidebar.courseSearchEmpty'

const zh: Record<TranslationKey, string> = {
  ...progressZh,
  'search.placeholder': '搜索关卡或知识点',
  'search.noResults': '没有找到相关知识点',
  'search.resultMeta': '{course} · 第 {order} 关',
  'search.matchLabel': '匹配：{text}',
  'search.clear': '清空搜索',
  'nav.dashboard': '首页',
  'nav.upload': '导入课件',
  'nav.lessons': '闯关冲刺',
  'nav.wrongbook': '错题本',
  'nav.chat': 'Athena',
  'nav.settings': '设置',
  'nav.levelUnit': '关卡',
  'nav.generating': '生成中...',
  'settings.title': '设置',
  'settings.subtitle': '应用信息与偏好设置',
  'settings.appDesc': 'AI 驱动的闯关式期末冲刺助手',
  'settings.statsCourses': '课程',
  'settings.statsFiles': '课件文件',
  'settings.localInfo': '本地信息',
  'settings.localInfoDesc': '应用数据完全存储在本地，无需账户登录',
  'settings.localDataTitle': '数据本地存储',
  'settings.localDataDesc': '所有课程、学习记录和设置均保存在本机，无需联网即可使用全部功能',
  'settings.teacher': '身份设置',
  'settings.teacherDesc': '设置您的用户身份',
  'settings.teacherToggle': '我是教师',
  'settings.teacherOn': '已开启',
  'settings.teacherOff': '点击开启',
  'settings.api': 'API 配置',
  'settings.apiDesc': '模型供应商、API Key 与参数',
  'settings.storage': '课件存储',
  'settings.storageDesc': '查看课件文件、存储位置和迁移选项',
  'settings.data': '数据管理',
  'settings.dataDesc': '课程数据统计与清除',
  'settings.about': '关于',
  'settings.aboutDesc': '应用信息与联系方式',
  'settings.appearance': '外观与语言',
  'settings.appearanceDesc': '切换浅色/深色主题，选择界面语言',
  'settings.language': '语言',
  'settings.theme': '外观',
  'settings.themeLight': '浅色',
  'settings.themeDark': '深色',
  'settings.uiFontSize': 'UI 字号',
  'settings.uiFontSizeDesc': '只调整界面文字大小，不缩放窗口，避免内容被裁切。',
  'settings.uiFontSizeReset': '标准',
  'settings.applied': '已应用',
  'settings.applyLanguage': '应用语言',
  'about.subtitle': '了解 ChillPass 与联系信息',
  'about.appInfo': '应用信息',
  'about.appName': '应用名称',
  'about.backToSettings': '返回设置',
  'about.joinUs': '加入我们',
  'about.joinUsDesc': '添加开发者微信，交流反馈或参与项目共建',
  'about.wechat': '微信号',
  'about.copy': '复制',
  'about.copied': '已复制',
  'titlebar.balance': '供应商余额',
  'titlebar.balanceQuery': '查询余额',
  'titlebar.balanceLoading': '查询中',
  'titlebar.balanceUnavailable': '余额不可用，点击重试',
  'titlebar.balanceRefresh': '点击刷新余额',
  'titlebar.balanceNoKey': '未配置',
  'titlebar.balanceUnsupported': '不支持',
  'titlebar.providerSwitch': '切换供应商',
  'titlebar.focusMode': '专注模式',
  'titlebar.exitFocus': '退出专注',
  'common.back': '返回',
  'common.save': '保存',
  'common.saved': '已保存',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'titlebar.minimize': '最小化',
  'titlebar.close': '关闭',
  'dashboard.welcome': '欢迎回来',
  'dashboard.noCourse': '还没有课程',
  'dashboard.noCourseDesc': '导入课件开始你的备考之旅',
  'dashboard.importBtn': '导入课件',
  'dashboard.countdown': '考试倒计时',
  'dashboard.daysLeft': '天后考试',
  'dashboard.examToday': '今天考试！加油！',
  'dashboard.setExamDate': '设置考试日期',
  'dashboard.progress': '学习进度',
  'dashboard.quickAsk': '问 Athena',
  'dashboard.quickImport': '导入课件',
  'dashboard.quickQuest': '闯关冲刺',
  'upload.title': '导入课件',
  'upload.subtitle': '上传课件文件，AI 自动提取考点生成关卡',
  'upload.courseName': '课程名称',
  'upload.courseNamePlaceholder': '输入课程名称',
  'upload.examDate': '考试日期（可选）',
  'upload.selectFiles': '选择文件',
  'upload.dragHere': '拖拽文件到此处',
  'upload.modeCreate': '新建课程',
  'upload.modeAppend': '导入到已有课程',
  'upload.start': '开始导入',
  'upload.importing': '导入中...',
  'lessons.title': '闯关冲刺',
  'lesson.keyPoints': '核心知识点',
  'lesson.examples': '例题',
  'lesson.quiz': '小测',
  'lesson.complete': '完成关卡',
  'lesson.nextPage': '下一题',
  'lesson.finish': '完成关卡',
  'lesson.retry': '再试一次',
  'lesson.changeQuestion': '换一道',
  'lesson.submit': '提交答案',
  'lesson.correctAnswer': '正确答案',
  'lesson.standardAnswer': '标准答案',
  'lesson.showAnswer': '直接看答案',
  'lesson.hideAnswer': '收起答案',
  'lesson.answerViewed': '已看答案',
  'lesson.answerViewHint': '仅查看参考答案，不提交作答、不判分，也不会加入错题本。仍可继续作答或跳过。',
  'lesson.referenceUnavailable': '这道题暂无可用的参考答案，可点击“重新生成”换一道题。',
  'wrongbook.title': '错题本',
  'wrongbook.empty': '暂无错题，继续加油！',
  'wrongbook.yourAnswer': '你的答案',
  'wrongbook.correctAnswer': '正确答案',
  'wrongbook.askAthena': '去问 Athena',
  'wrongbook.mastered': '已掌握',
  'wrongbook.clear': '清空',
  'athena.title': 'Athena',
  'athena.subtitle': '你的智能学伴',
  'athena.thinking': '正在思考...',
  'athena.basedOn': '基于「{course}」课件',
  'athena.idle': '待命',
  'athena.tasking': '执行任务中',
  'athena.abilities': '技能管理',
  'athena.memories': '记忆管理',
  'athena.taskQa': '自由提问',
  'athena.taskPaper': '论文代写',
  'athena.taskReport': '报告代写',
  'athena.taskSummary': '知识总结',
  'athena.taskPlan': '复习计划',
  'athena.taskQaDesc': '随时问任何问题',
  'athena.taskPaperDesc': '学术论文结构化撰写',
  'athena.taskReportDesc': '格式规范的报告撰写',
  'athena.taskSummaryDesc': '系统梳理核心知识点',
  'athena.taskPlanDesc': '制定可执行的复习安排',
  'athena.startTask': '开始执行',
  'athena.inputPlaceholder': '输入你的问题...',
  'athena.charterMemory': '宪章记忆',
  'athena.flowMemory': '流动记忆',
  'athena.export': '导出 Athena',
  'athena.import': '导入 Athena',
  'onboarding.welcomeTitle': '欢迎使用 ChillPass',
  'onboarding.welcomeSubtitle': '你的 AI 学习伙伴 —— 从期末冲刺到论文写作',
  'onboarding.privacyNote': '所有数据仅保存在本机，完全离线运行，无需注册登录',
  'onboarding.languageLabel': '界面语言',
  'onboarding.overviewTitle': '三步开始你的冲刺',
  'onboarding.step1Title': '配置 API Key',
  'onboarding.step1Desc': '填入你的 DeepSeek API Key，解锁全部 AI 能力',
  'onboarding.step2Title': '导入课件',
  'onboarding.step2Desc': '上传 PDF / Word / PPTX / TXT / MD 课程资料',
  'onboarding.step3Title': 'AI 生成闯关课程',
  'onboarding.step3Desc': '自动提炼考点，按优先级生成关卡、例题与小测',
  'onboarding.startTitle': '准备好了吗？',
  'onboarding.startDesc': '第一步是配置 DeepSeek API Key，大约需要 2 分钟',
  'onboarding.goConfig': '去配置 API',
  'onboarding.prev': '上一步',
  'onboarding.next': '下一步',
  'onboarding.skip': '跳过引导',
  'settings.reviewGuide': '重新查看新手引导',
  'settings.reviewGuideDesc': '重新查看欢迎说明和基础配置入口',
  'tokens.title': 'Token 用量',
  'tokens.desc': '统计本设备发起的模型 API 调用消耗',
  'tokens.total': '累计 Tokens',
  'tokens.today': '今日消耗',
  'tokens.calls': '调用次数',
  'tokens.prompt': '输入',
  'tokens.completion': '输出',
  'tokens.last7': '近 7 日',
  'tokens.reset': '清除统计',
  'tokens.resetConfirm': '确定要清除所有 Token 统计数据吗？',
    'tokens.empty': '暂无调用记录',
  'sidebar.courseManage': "课程管理",
  'sidebar.importShort': '导入',
  'sidebar.exportShort': '导出',
  'sidebar.courseSearch': "搜索课程",
  'sidebar.courseSearchEmpty': "没有匹配的课程",
  'athena.conversation': "会话",
  'athena.newChat': "新会话",
  'athena.deleteChat': "删除该会话",
  'athena.messageCount': "{count} 条消息",
  'chat.svgSource': "查看 SVG 源码",
  'img.invalidFormat': "无法读取该图片，请改用 PNG、JPEG、WebP 或 GIF 格式",
  'img.tooLarge': "图片过大，压缩后仍无法发送，请换一张更小的图片",
  'athena.imageDirectSend': "图片将直接发送给多模态模型解析",
  'athena.visionUnsupported': "当前模型 {model} 不支持图片理解，请在设置中切换到支持视觉的模型（如 deepseek-flash）",
  'lesson.review': "复核",
  'lesson.retryReview': "重新复核",
  'lesson.reviewTitle': "对参考答案有疑问？让 AI 独立重做一遍这道题",
  'lesson.reviewRunning': "AI 正在独立复核这道题…",
  'lesson.reviewFailed': "复核失败",
  'lesson.reviewYouWereRight': "复核结果：你答对了",
  'lesson.reviewYouWereWrong': "复核结果：参考答案无误",
  'lesson.adjudicating': "你的答案与参考答案不一致，AI 正在独立复核这道题…",
  'lesson.keyFixedNote': "复核结果：题目标注的参考答案有误，你的回答是正确的。本题答案已修正，且不计入错题本。",
  'model.deepseekFlash': "deepseek-flash — V4.1 Flash，响应快、成本低，支持图像理解",
  'model.deepseekV4Pro': "deepseek-v4-pro — V4 Pro 旗舰，推理能力最强，适合复杂题目与长文（不支持图像）",
  'model.deepseekV4FlashLegacy': "deepseek-v4-flash — 旧版 ID，仍可调用但已由 Flash 接替",
  'model.deepseekVisionExp': "deepseek-v4-flash-vision-exp — 视觉实验版，旧版 ID",
  'model.deepseekChatLegacy': "deepseek-chat — 已于 2026-07-24 退役，调用会失败，请改用 deepseek-flash",
  'model.deepseekReasonerLegacy': "deepseek-reasoner — 已于 2026-07-24 退役，调用会失败，请改用 deepseek-flash",
  'model.customCompatible': "OpenAI 兼容模型，可按自定义供应商实际模型 ID 修改",
  'model.unknownDesc': "账号可用模型（暂无内置说明）",
  'api.modelRefresh': "加载可用模型",
  'api.modelRefreshing': "正在拉取…",
  'api.modelRefreshOk': "已从服务商获取 {count} 个可用模型",
  'api.modelRefreshFailed': "拉取失败：{msg}",
  'api.modelNeedKey': "请先在上方填写 API Key，再加载模型列表",
  'api.modelBuiltinHint': "当前为内置模型列表，点击「加载可用模型」可获取账号实时可用的模型",
  'api.modelLiveHint': "列表来自服务商实时接口",
  'api.modelHoverHint': "将光标停在选项上可查看模型说明",
  'app.docTitle': "ChillPass — 期末冲刺助手",
  'wrongbook.subtitle': "按课程归类，逐个击破",
  'athena.memCategoryCustom': "自定义",
  'athena.noAbilitiesHint': "暂无技能，Athena 会在对话中自动发现新技能",
  'athena.autoTag': "自动发现",
  'athena.charterMemoryHint': "用户管理，Athena 必须遵守，不能自行修改",
  'athena.flowMemoryHint': "Athena 自动管理，记录用户偏好和学习习惯",
  'athena.noFlowMemoriesHint': "暂无流动记忆，Athena 会在对话中自动积累",
  'titlebar.helpQrAlt': "ChillPass 用户交流群二维码",
  'api.subtitle': "接入大模型，用于提炼考点与生成课程",
  'api.providerZhipu': "智谱 GLM",
  'api.providerCustom': "自定义",
  'api.providerAddCustom': "添加自定义供应商",
  'api.providerDeleteCustom': "删除自定义供应商",
  'api.providerDeleteConfirm': "确定要删除自定义供应商「{name}」吗？该供应商的本地 API Key、Base URL 和用量查询配置也会一起删除。",
  'storage.resLocation': "数据存储位置",
  'storage.migration': "资源迁移",
  'storage.defaultBadge': "默认",
  'storage.fileList': "课件文件清单",
  'storage.totalFiles': "共 {count} 个文件",
  'storage.totalSizeLabel': "总大小 {size}",
  'storage.filesMissing': "{count} 个文件缺失",
  'storage.checkingFiles': "正在检查文件...",
  'storage.targetDir': "目标目录",
  'storage.modeLabel': "迁移模式",
  'storage.modeCopy': "复制",
  'storage.modeMove': "移动",
  'storage.migratingProgress': "正在迁移文件... {percent}%",
  'storage.migratedCount': "成功迁移：{count} 个文件",
  'storage.migratedTotalSize': "迁移总量：{size}",
  'storage.targetDirResult': "目标目录：{dir}",
  'storage.firstRunTitle': "选择课件存储位置",
  'storage.firstRunDesc': "ChillPass 会把课件原文件、解析缓存和生成内容保存在本机。你可以使用默认位置，也可以选择其他磁盘或文件夹。",
  'storage.firstRunDefault': "默认位置：{path}",
  'storage.firstRunUseDefault': "使用默认位置",
  'storage.firstRunChoose': "选择其他目录",
  'storage.firstRunChoosing': "选择中...",
  'account.editTitle': "编辑个人资料",
  'account.createTitle': "创建本地账号",
  'account.modalSubtitle': "账号信息仅保存在本机，离线运行，无需联网",
  'account.offlineHintLogin': "当前为本地离线账号，所有信息仅保存在本机浏览器中，不会上传到任何服务器。",
  'account.offlineHintEditor': "当前为本地离线账号，所有信息仅保存在本机浏览器中，不会上传到任何服务器。可在设置中导出账号信息到新设备。",
  'account.nameLabel': "昵称 *",
  'account.namePlaceholder': "请输入昵称",
  'account.avatarLabel': "头像",
  'account.bioLabel': "个性签名",
  'account.bioPlaceholder': "一句话介绍自己（可选）",
  'account.nameRequired': "请输入昵称",
  'account.defaultName': "学习者",
  'account.pickAvatar': "选择头像 {emoji}",
  'account.close': "关闭",
  'account.createBtn': "创建账号",
  'service.noApiKey': "未设置 API Key，请在设置中配置",
  'service.timeout': "请求超时，请检查网络连接后重试",
  'service.network': "网络连接失败，请检查网络后重试",
  'service.apiError': "模型 API 错误: {code} - {msg}",
  'service.retriesExhausted': "请求失败，已重试 {count} 次",
  'service.genLessonFailed': "关卡内容生成失败，请重试",
  'service.emptyResponse': "AI 返回了空内容，请重试",
  'service.structuredOutputEmpty': "AI 返回了空内容",
  'service.structuredOutputTruncated': "AI 返回内容过长并被截断",
  'service.structuredOutputInvalid': "AI 返回的关卡 JSON 格式或内容结构不正确",
  'service.lessonGenerationRetryFailed': "关卡内容自动重试后仍未生成成功：{msg}",
  'service.regenQuestionFailed': "题目重新生成失败，请重试",
  'service.answerCorrectAll': "回答完全正确！",
  'service.answerCorrect': "回答正确，包含了所有关键点！",
  'service.answerPartial': "部分正确（命中 {matched}/{total} 个关键点），但还不够完整。参考答案：{answer}",
  'service.answerFeedbackOk': "回答正确！",
  'service.answerFeedbackBad': "回答不正确",
  'service.answerUngradeable': "暂时无法自动评阅，请检查网络或 API 配置后重新评阅。参考答案：{answer}",
  'service.fileNotFound': "找不到原课件文件，请返回导入课件并重新选择（文件标识：{id}）",
  'service.fileKeyMissing': "原课件文件未保存，请返回导入课件并重新选择原文件",
  'parse.unsupportedFormat': "不支持的文件格式: {ext}",
  'parse.apiUnavailable': "文件 API 不可用",
  'parse.docxNoXml': "无法读取 Word 文档内容（缺少 document.xml），请确认文件为有效的 .docx",
  'parse.docxNoText': "未能从 Word 文档中提取到文本内容",
  'parse.docIsRtf': "该文件实为 RTF 格式，请用 Word 另存为 .docx 后重新导入",
  'parse.docNoStream': "无法读取 Word 文档内容（WordDocument 流缺失）",
  'parse.docInvalid': "该文件不是有效的 Word 97-2003 文档",
  'parse.docNoText': "未能从 DOC 文件中提取到有效文本，建议用 Word 将文件另存为 .docx 后重新导入",
  'parse.docInvalidOle': "该文件不是有效的 Word 97-2003 文档（缺少 OLE 复合文档头）",
  'img.apiUnavailable': "无法读取文件，文件 API 不可用",
  'model.glmFlash': "glm-5.3-flash（高速响应，性价比高）",
  'model.glm53': "glm-5.3（旗舰模型，能力更强）",
  'mock.dirDialogPrompt': "浏览器模式下不支持选择目录，文件将存储在浏览器 IndexedDB 中",
  'mock.userDataPath': "浏览器 IndexedDB 存储",
  'mock.closeConfirm': "确定要关闭应用吗？",
  'mock.installPath': "未安装（网页预览模式）",
  'mock.userDataBrowser': "浏览器 IndexedDB / localStorage",
  'mock.tempPath': "浏览器内存",
  'mock.installPathAlert': "当前为网页预览模式，未安装应用，无法定位安装位置",
  'mock.noReleaseNotes': "暂无更新说明",
  'mock.updateServerUnreachable': "无法连接更新服务器，请检查网络后重试（{msg}）",
  'common.unknownError': "未知错误",
  'storage.migrateFailedRetry': "迁移失败，请重试",
  'storage.cardDesc': "查看课件文件、存储位置和迁移选项",
  'storage.dirHint': "此目录保存课件原文件。更换目录后，新文件使用新位置，旧文件保留且仍可读取；关卡与答题记录保存在浏览器中。",
  'storage.browserDirHint': "课件保留在课程文件夹；课程、关卡、学习进度、答题与 Athena 数据保存在 _chillpass-data，修改前自动备份。更换目录会复制学习数据，原课件仍可读取；目标已有不同数据时不会覆盖。API key 和界面偏好仍保存在浏览器。",
  'storage.browserFilesTitle': "课件文件",
  'storage.browserFileDesc': "以下是应用记录的课件文件。你也可以在资源管理器中向对应课程文件夹添加文件，再回到导入页手动扫描。",
  'storage.browserToFolderTitle': "迁移旧浏览器文件",
  'storage.browserToFolderHint': "检测到 {count} 个浏览器存储文件，可复制到当前资源目录，校验通过后自动更新路径。",
  'storage.browserToFolderAction': "迁移到 ChillPass 文件夹",
  'storage.browserAlreadyMigrated': "当前课程文件路径已经指向本机文件夹，无需迁移。",
  'storage.localBackendUnavailable': "本地文件服务不可用，请使用安装版或本地开发服务器打开应用。",
  'storage.gettingPath': "正在获取默认路径...",
  'storage.selecting': "选择中...",
  'storage.selectDir': "选择目录",
  'storage.resetDefault': "恢复默认",
  'storage.migrateDesc': "将所有课程的课件文件统一迁移到目标目录，释放 C 盘空间。迁移完成后，应用内的文件路径将自动更新。",
  'storage.noFiles': "暂无课件文件，请先在「导入课件」页面上传课程资料",
  'storage.noTarget': "未选择目标目录",
  'storage.selectTarget': "选择目标目录",
  'storage.moveMode': "移动模式：将文件从原位置转移到目标目录，可最大化释放原位置空间。",
  'storage.copyMode': "复制模式：将文件复制到目标目录，保留原文件。",
  'storage.migrateDone': "迁移完成",
  'storage.migrateFailed': "迁移失败",
  'storage.pathUpdated': "已自动更新 {count} 个文件路径，上方文件清单已同步为新路径。",
  'storage.migrating': "迁移中...",
  'storage.startMigrate': "开始迁移",
  'data.title': "数据管理",
  'data.subtitle': "管理本地存储的课程与学习数据",
  'data.statsTitle': "数据统计",
  'data.statsDesc': "查看当前本地存储的课程与课件数量",
  'data.courseCount': "课程数量",
  'data.storageTitle': "存储信息",
  'data.storageDesc': "查看数据存储位置与磁盘占用情况",
  'data.installPath': "安装位置",
  'data.loading': "加载中...",
  'data.locateTip': "在资源管理器中定位安装位置",
  'data.locate': "定位",
  'data.userDataPath': "数据存储位置",
  'data.diskUsage': "磁盘占用",
  'data.courseDataApprox': "课程数据约 {size}",
  'data.byCourse': "按课程占用",
  'data.dangerTitle': "危险操作",
  'data.dangerDesc': "只删除课程、课件缓存、考点、错题与闯关进度；API Key、模型、主题、语言和字号等设置会保留",
  'data.clearAll': "清除所有课程数据",
  'data.clearConfirm': "确定要清除所有课程数据吗？此操作不可恢复，但 API Key、模型、主题、语言和字号等设置会保留。",
  'data.confirmClear': "确认清除",
  'api.cardTitle': "模型接入",
  'api.cardDesc': "配置 API Key 与模型，所有数据仅保存在本地，不会上传至任何第三方服务",
  'api.provider': "接口提供商",
  'api.hintZhipu': "使用智谱 AI 开放平台，国内访问友好，glm-5.3-flash 适合快速生成",
  'api.hintDeepseek': "使用 DeepSeek 大模型，适合考点推理与内容生成",
  'api.hintCustom': "使用 OpenAI 兼容接口；需要填写 API Key、Base URL 和模型 ID",
  'api.hintOpenAICompat': "使用 OpenAI 兼容接口；Base URL 和模型列表可按服务商实际情况调整",
  'api.customNameLabel': "供应商名称",
  'api.customNamePlaceholder': "例如：Claude 官方 / OpenAI 兼容代理",
  'api.customBaseUrlLabel': "API Base URL",
  'api.customBaseUrlPlaceholder': "例如：https://api.example.com/v1",
  'api.customBaseUrlHint': "填写 OpenAI 兼容根地址即可，例如 /v1；系统会自动请求 /chat/completions 和 /models。",
  'api.customBaseUrlRequired': "请先填写自定义供应商的 API Base URL",
  'api.customUsageEnabled': "启用自定义用量查询",
  'api.customUsageOptionalTitle': "用量查询（可选）",
  'api.customUsageOptionalDesc': "只影响右上角余额显示，不配置也可以正常生成内容",
  'api.customUsageHint': "用于右上角余额/额度按钮；脚本只在本机执行，需返回 remaining 或 total/used 等字段。",
  'api.customUsageScript': "用量查询脚本",
  'api.customUsageReset': "恢复示例",
  'api.customUsageVars': "可用变量：{{baseUrl}}、{{apiKey}}。extractor(response) 返回 isValid、remaining、unit、total、used、extra。",
  'api.keyLabel': "API Key",
  'api.keyPhZhipu': "请输入智谱 API Key",
  'api.keyPhDeepseek': "请输入 DeepSeek API Key",
  'api.keyPhCustom': "请输入自定义供应商 API Key",
  'api.hideKey': "隐藏 API Key",
  'api.showKey': "显示 API Key",
  'api.keyHintZhipu': "可在智谱开放平台获取，数据仅保存在本地",
  'api.keyHintDeepseek': "可在 DeepSeek 开放平台获取，数据仅保存在本地",
  'api.keyHintCustom': "使用该供应商提供的 Key，数据仅保存在本地",
  'api.linkZhipu': "前往智谱开放平台获取 API Key",
  'api.linkDeepseek': "前往 DeepSeek 开放平台获取 API Key",
  'api.modelLabel': "模型",
  'api.modelHintZhipu': "glm-5.3-flash 适合快速生成，glm-5.3 适合复杂考点推理",
  'api.modelHintDeepseek': "deepseek-chat 适合快速生成，deepseek-reasoner 适合复杂考点推理",
  'api.save': "保存设置",
  'athena.fLevel': "学术级别",
  'athena.fLevelPh': "例如：本科 / 硕士 / 课程论文",
  'athena.fReportTopic': "报告主题",
  'athena.fReportTopicPh': "例如：实验报告 / 调研报告",
  'athena.fReportType': "报告类型",
  'athena.fReportTypePh': "例如：实验报告 / 调研报告 / 读书报告",
  'athena.fSummaryScope': "总结范围",
  'athena.fSummaryScopePh': "例如：第一章到第三章 / 全部课件",
  'athena.fOutputFormat': "输出格式",
  'athena.fOutputFormatPh': "例如：表格 / 思维导图 / 列表",
  'athena.noReply': "抱歉，我没有收到回复内容，请重试。",
  'athena.unknownError': "发生未知错误",
  'athena.errorPrefix': "出错了：{msg}",
  'athena.statusThinking': "思考中",
  'athena.statusTasking': "执行任务中",
  'athena.clearChat': "清空对话",
  'athena.openFullChat': "打开完整聊天页",
  'layout.showNavigation': '展开导航栏',
  'layout.hideNavigation': '收起导航栏',
  'athena.showSidebar': '打开 Athena 侧边聊天',
  'athena.hideSidebar': '收起 Athena 侧边聊天',
  'athena.expandPanel': '全屏显示',
  'athena.restorePanel': '退出全屏',
  'athena.sidebarDescription': '边学边聊，随时提问。对话会自动保存。',
  'athena.welcomeMsg': "我是你的智能学伴，选择一个任务开始吧",
  'athena.currentTask': "当前任务：{task}",
  'athena.attachedImage': "附加图片",
  'athena.attachedFile': "附加文件",
  'athena.removeImage': "移除图片",
  'athena.insertImage': "插入图片",
  'athena.addAttachment': "添加附件",
  'athena.dropAttachments': "松开添加附件",
  'athena.fileTextReady': "文件内容将作为上下文发送",
  'athena.fileMetaOnly': "无法直接读取内容，将发送文件信息",
  'athena.attachmentProcessing': "正在处理附件",
  'athena.attachmentProcessingHint': "图片压缩或文档解析中...",
  'athena.attachmentOnlyPrompt': "请查看附件：{files}",
  'athena.thinkingPlaceholder': "Athena 正在思考...",
  'athena.taskInputHint': "{task} - 输入内容，Enter 发送",
  'athena.chatInputHint': "输入你的问题，Enter 发送，Shift+Enter 换行",
  'athena.send': "发送",
  'athena.infoCollect': "信息收集",
  'athena.unspecified': "未指定",
  'athena.taskPromptPrefix': "请根据以下信息执行任务：",
  'athena.abilityNamePlaceholder': "技能名称（如：论文写作）",
  'athena.abilityDescPlaceholder': "技能描述",
  'athena.add': "添加",
  'athena.importSuccess': "Athena 配置导入成功！",
  'athena.addCharterMemory': "添加新的宪章记忆...",
  'athena.edit': "编辑",
  'athena.fTopic': "论文主题",
  'athena.fTopicPh': "例如：论人工智能对高等教育的影响",
  'athena.fWords': "字数要求",
  'athena.fWordsPh': "例如：3000字",
  'athena.fWordsReportPh': "例如：2000字",
  'athena.fSpecial': "特殊要求",
  'athena.fSpecialPh': "例如：需要参考文献、特定格式等",
  'athena.fSpecialReportPh': "例如：需要数据图表等",
  'athena.fSummaryFocus': "总结重点",
  'athena.fSummaryFocusPh': "例如：重点公式、核心概念",
  'athena.fExamDate': "考试日期",
  'athena.fExamDatePh': "例如：2026-07-01",
  'athena.fDailyTime': "每日可学习时间",
  'athena.fDailyTimePh': "例如：3小时",
  'athena.fWeakAreas': "薄弱环节",
  'athena.fWeakAreasPh': "例如：第3-5章比较难",
  'athena.fMastered': "已掌握内容",
  'athena.fMasteredPh': "例如：第1-2章已复习完",
  'teacher.qTypeCalculation': "计算题",
  'teacher.qTypeEssay': "论述题",
  'teacher.diffEasy': "简单",
  'teacher.diffMedium': "中等",
  'teacher.diffHard': "困难",
  'teacher.errPrintWindow': "无法创建打印窗口",
  'teacher.errSelectCourse': "请先选择一个课程",
  'teacher.errNoCourseware': "该课程没有课件文本，请先导入并分析课件",
  'teacher.errGenerate': "生成失败，请重试（可能是网络问题或课件内容不足）",
  'teacher.errGenerateShort': "生成失败，请重试",
  'teacher.clearConfirm': "确定要清空所有已生成的题目吗？",
  'teacher.errExportEmpty': "请先生成题目再导出",
  'teacher.errTranslate': "翻译失败，将使用中文内容导出",
  'teacher.defaultPaperTitle': "{course}期末考试试卷",
  'teacher.courseFallback': "课程",
  'teacher.title': "教师工作台",
  'teacher.subtitle': "从课件生成试题，组装试卷并导出 PDF",
  'teacher.selectCourse': "选择课程",
  'teacher.selectCourseDesc': "选择已导入课件内容的课程作为出题来源",
  'teacher.noCourses': "暂无课程，请先导入课件",
  'teacher.charsCount': "{n} 字",
  'teacher.noText': "无文本",
  'teacher.generate': "生成题目",
  'teacher.generateDesc': "选择题型、难度和数量，AI 根据课件内容生成试题",
  'teacher.fieldQType': "题型",
  'teacher.fieldDifficulty': "难度",
  'teacher.fieldCount': "数量",
  'teacher.countHint': "题（1-50）",
  'teacher.generating': "正在生成...",
  'teacher.generateBtn': "生成题目",
  'teacher.listTitle': "题目列表",
  'teacher.listSummary': "共 {count} 题，合计 {points} 分",
  'teacher.groupSummary': "{count} 题 · {points} 分",
  'teacher.pointsUnit': "分",
  'teacher.labelOptions': "选项：",
  'teacher.labelCorrect': "正确",
  'teacher.labelAnswer': "答案：",
  'teacher.labelSteps': "解题步骤：",
  'teacher.labelAcceptable': "可接受答案：",
  'teacher.labelExplanation': "解析：",
  'teacher.assemble': "组装试卷并导出",
  'teacher.assembleDesc': "设置试卷标题、考试时长和出题语言，导出为 PDF 打印",
  'teacher.assembleTranslateHint': "（非中文将自动翻译全部内容后导出）",
  'teacher.fieldPaperTitle': "试卷标题",
  'teacher.fieldDuration': "考试时长（分钟）",
  'teacher.fieldLanguage': "出题语言",
  'teacher.summaryQuestions': "{count} 道题目",
  'teacher.summaryDuration': "{count} 分钟",
  'teacher.translatingExport': "正在翻译并导出...",
  'teacher.exportPdf': "导出为 PDF",
  'lesson.notFound': "关卡不存在或已被移除",
  'lesson.backToList': "返回关卡列表",
  'lesson.noExamPoint': "找不到对应考点信息",
  'lesson.genFailedRetry': "内容生成失败，请重试",
  'lesson.gradeFailed': "评阅失败，请重试",
  'lesson.regenerateFailed': "题目重新生成失败，请重试",
  'lesson.orderLabel': "第 {n} 关",
  'lesson.regenerating': "正在重新生成学习内容...",
  'lesson.tabPoints': "知识点",
  'lesson.explanationTitle': "详细解释",
  'lesson.noExamples': "本关暂无例题",
  'lesson.exampleN': "例题 {n}",
  'lesson.stepsLabel': "解题步骤",
  'lesson.answerLabel': "答案",
  'lesson.noQuiz': "本关暂无小测题",
  'lesson.questionN': "问题 {cur} / {total}",
  'lesson.qTypeChoice': "单选题",
  'lesson.qTypeMulti': "多选题",
  'lesson.qTypeFill': "填空题",
  'lesson.qTypeShort': "简答题",
  'lesson.yourAnswerPlaceholder': "请输入你的答案",
  'lesson.answerCorrect': "回答正确",
  'lesson.answerWrong': "回答错误",
  'lesson.answerUngradeable': "暂未判定",
  'lesson.retryGrading': "重新评阅",
  'lesson.regenerateTitle': "生成同知识点的新题目",
  'lesson.regenerate': "重新生成",
  'lesson.regenerateContent': "优化本关内容",
  'lesson.regenerateContentHint': "成功后才替换当前内容，关卡进度保持不变",
  'lesson.confirmRegenerate': "确认重新生成",
  'lesson.restorePrevious': "恢复上一版",
  'lesson.regenerateSuccess': "新内容已生成，原版本仍可恢复",
  'lesson.regenerateCancelled': "本关内容优化已取消，原内容保持不变。",
  'lesson.restoreSuccess': "已恢复上一版内容和作答记录",
  'lesson.skipTitle': "跳到下一题",
  'lesson.skipCost': "跳过",
  'lesson.tryAgain': "再试一次",
  'lesson.submitWithCount': "提交答案（已选 {count} 项）",
  'lesson.grading': "评阅中...",
  'lesson.completed': "本关已完成",
  'lesson.generatingWait': "内容正在生成中，请稍候...",
  'lesson.genFailedManual': "关卡内容生成失败，你可以尝试手动重新生成。",
  'wrongbook.clearConfirm': "确定要清空「{name}」的所有错题吗？此操作不可撤销。",
  'wrongbook.noAnswer': "未作答",
  'wrongbook.unknown': "未知",
  'wrongbook.prefillChoice': "我在「{lesson}」这关遇到了一道错题：\n题目：{question}\n我选了：{my}\n正确答案：{correct}\n请帮我理解这个知识点。",
  'wrongbook.prefillText': "我在「{lesson}」这关遇到了一道错题：\n题目：{question}\n我的答案：{my}\n参考答案：{correct}\n请帮我理解这个知识点。",
  'wrongbook.keepGoing': "继续保持！",
  'lessons.defaultGroup': "默认分组",
  'lessons.emptyTitle': "还没有闯关路径",
  'lessons.emptyDesc': "先导入课件，AI 会自动为你生成考点闯关路径",
  'lessons.goImport': "去导入课件",
  'lessons.groupProgress': "{done}/{count} 关",
  'lessons.statusDone': "已完成",
  'lessons.statusLocked': "未解锁",
  'lessons.tapStart': "点击开始",
  'lessons.batchRegenerate': "批量优化课程",
  'lessons.batchConfirmTitle': "扫描遗漏并优化所有关卡？",
  'lessons.batchConfirmDesc': "将重新扫描原课件，只增补遗漏知识点，再优化所有关卡内容。原有关卡、完成状态和课程进度都会保留，每关的上一版本及作答记录均可恢复。",
  'lessons.batchStart': "开始批量优化",
  'lessons.batchCancel': "取消",
  'lessons.batchProgress': "正在优化 {current}/{total}：{title}",
  'lessons.batchScanning': "正在重新扫描原课件中的遗漏知识点…",
  'lessons.batchScanFailed': "；遗漏知识点扫描失败，原有关卡仍已继续优化",
  'lessons.batchResult': "批量优化完成：新增 {added} 关，内容成功 {success} 关，失败 {failed} 关{scanStatus}",
  'lessons.batchCancelled': "本次批量优化已取消，已完成的关卡内容会保留。",
  'lessons.batchFailed': "批量优化失败，请重试。",
  'lessons.rebuildStructure': "重建关卡结构",
  'lessons.rebuildConfirmTitle': "重新扫描并重建关卡结构？",
  'lessons.rebuildConfirmDesc': "会重新提炼课件并按新的推荐数量重建关卡，关卡数量可能变多或变少。能匹配上的旧关卡内容和完成状态会保留，没匹配上的新关卡需要重新生成。",
  'lessons.rebuildStart': "开始重建",
  'lessons.rebuildRunning': "正在重新提炼并重建关卡结构…",
  'lessons.rebuildResult': "重建完成：{before} 关 → {after} 关，复用已生成内容 {reused} 关，待生成 {pending} 关。",
  'lessons.rebuildFailed': "重建关卡结构失败，请检查课件内容后重试。",
  'lessons.clearCompleted': "清除已完成",
  'lessons.clearCompletedConfirmTitle': "清除已完成进度？",
  'lessons.clearCompletedConfirmDesc': "只会把当前课程已完成的关卡重置为可学习；已生成内容、题目、课件、错题本和 API 设置都会保留。",
  'lessons.clearCompletedStart': "确认清除",
  'lessons.clearCompletedDone': "已清除完成进度，可以从头再来。",
  'titlebar.restore': "还原",
  'titlebar.maximize': "最大化",
  'titlebar.help': "帮助",
  'titlebar.helpTitle': "ChillPass",
  'titlebar.helpIntroTitle': "怎么用",
  'titlebar.helpIntroBody': "ChillPass 会把课件整理成可闯关学习的关卡。你先选课程或导入资料，生成后可以边学边做题；答错会进错题本，课件文件保存在本机 ChillPass 文件夹。",
  'titlebar.helpQuickTitle': "常用流程",
  'titlebar.helpItem1T': "选课程",
  'titlebar.helpItem1D': "左下角可切换当前课程；导入到已有课程时会跟随当前课程",
  'titlebar.helpItem2T': "导入资料",
  'titlebar.helpItem2D': "在「导入课件」中新建课程或追加到已有课程，支持 PDF / Word / 图片等课件",
  'titlebar.helpItem3T': "生成关卡",
  'titlebar.helpItem3D': "点击生成后，顶部进度图标可查看解析和生成状态；已生成的关卡可以先学",
  'titlebar.helpItem4T': "开始学习",
  'titlebar.helpItem4D': "进入「闯关冲刺」按关卡学习；题目可提交、跳过、重新生成，也可以直接查看答案",
  'titlebar.helpItem5T': "复习错题",
  'titlebar.helpItem5D': "答错内容会进入「错题本」，可以按课程回看并标记掌握",
  'titlebar.helpItem6T': "管理数据",
  'titlebar.helpItem6D': "在设置里查看本地存储、课程文件夹和字体大小；清除课程数据不会删除 API Key 等设置",
  'titlebar.helpItem7T': "AI 助教",
  'titlebar.helpItem7D': "Athena 智能体支持论文写作、知识总结等任务工作流",
  'titlebar.helpItem8T': "教师工作台",
  'titlebar.helpItem8D': "在设置中开启「教师模式」，可生成试卷并导出 PDF",
  'titlebar.helpItem10T': "专注模式",
  'titlebar.helpItem10D': "点击右上角按钮进入全屏专注模式，屏蔽干扰",
  'titlebar.helpContactTitle': "开发者联系方式",
  'titlebar.helpWechat': "微信",
  'titlebar.helpVersionLabel': "版本",
  'titlebar.helpVersionValue': "CYRicky个人改动版",
  'titlebar.helpQrText': "扫码加入 ChillPass 用户交流群",
  'titlebar.helpGotIt': "我知道了",
  'sidebar.workspace': "工作台",
  'upload.pageSubtitle': "上传你的课程资料，AI 将自动提炼考点并生成闯关路径",
  'upload.stEmpty': "空",
  'upload.stUploaded': "已上传",
  'upload.stAnalyzing': "分析中",
  'upload.stReady': "就绪",
  'upload.errPickFile': "选择文件失败，请重试",
  'upload.errNameRequired': "请输入课程名称",
  'upload.errFilesRequired': "请至少上传一个课件文件",
  'upload.parsing': "正在解析课件...",
  'upload.errDuplicateName': "已存在同名课程，请使用其他名称或通过\"导入到已有课程\"追加内容",
  'upload.parsingFile': "正在解析 {name}（{i}/{n}）",
  'upload.extracting': "正在提炼考点，生成闯关路径...",
  'upload.doneJump': "导入完成！正在跳转...",
  'upload.parseFailed': "解析失败，请重试",
  'upload.errSelectCourse': "请选择要导入的课程",
  'upload.errCourseMissing': "所选课程不存在，请重新选择",
  'upload.errOptimizationBusy': "该课程正在优化中，请完成或取消优化后再追加课件",
  'upload.parsingAppend': "正在解析新增课件...",
  'upload.allSkipped': "所有文件与已有内容重复率过高，已全部跳过",
  'upload.extractingAppend': "正在从新增课件中提炼考点...",
  'upload.newFilesCount': "{count} 个新文件",
  'upload.merging': "正在合并考点，生成新关卡...",
  'upload.appendDone': "增量导入完成！正在跳转...",
  'upload.processing': "处理中...",
  'upload.startAppend': "增量导入",
  'upload.modeAppendFull': "导入到已有课程",
  'upload.appendTip': "将新课件追加到已有课程",
  'upload.noExisting': "暂无已有课程",
  'upload.appendModeHint': "暂无已有课程，无法使用增量导入",
  'upload.courseNameExample': "例如：高等数学（下）",
  'upload.selectExisting': "选择已有课程",
  'upload.selectedInfo': "已选课程：{name} · 考点 {points} 个 · 关卡 {lessons} 个",
  'upload.dropAppend': "选择要追加的新课件文件，或拖拽到此处",
  'upload.dropCreate': "点击选择文件，或拖拽到此处",
  'upload.dropzoneHint': "支持 PDF、Word（doc/docx）、PPTX、TXT、Markdown",
  'upload.removeFile': "删除文件",
  'upload.goConfig': "去配置",
  'upload.skipped': "已跳过 {count} 个重复文件：{names}",
  'upload.scanCourseFolder': "扫描课程文件夹",
  'upload.openCourseFolder': "打开课程文件夹",
  'upload.noNewFolderFiles': "课程文件夹里没有发现新的课件文件",
  'upload.courseFolderReady': "已创建课程文件夹：{path}",
  'upload.stepParse': "解析课件",
  'upload.stepPath': "生成路径",
  'dashboard.badge': "ChillPass · 期末冲刺助手",
  'dashboard.heroTitle': "开始你的期末冲刺",
  'dashboard.heroSubtitle': "上传课件，AI 自动提炼考点，生成闯关式冲刺课程",
  'dashboard.stepExtract': "提炼考点",
  'dashboard.stepQuest': "闯关冲刺",
  'dashboard.statusEmpty': "未导入",
  'dashboard.statusUploaded': "已导入",
  'dashboard.statusAnalyzing': "分析中",
  'dashboard.statusReady': "已就绪",
  'dashboard.priorityMust': "必考",
  'dashboard.priorityHigh': "高频",
  'dashboard.priorityKnow': "了解",
  'dashboard.deleteConfirm': "确定要删除课程「{name}」吗？此操作不可撤销。",
  'dashboard.importFailedFormat': "导入失败：文件格式不正确",
  'dashboard.importSuccess': "课程导入成功！",
  'dashboard.importDuplicate': "该课程已存在（名称或考点重复），已自动切换到已有课程",
  'dashboard.importFailedParse': "导入失败：无法解析 JSON 文件",
  'dashboard.importFailedRead': "导入失败：读取文件出错",
  'dashboard.renameCourse': "重命名课程",
  'dashboard.exportCourse': "导出课程",
  'dashboard.deleteCourse': "删除课程",
  'dashboard.newCourse': "新建课程",
  'dashboard.importCourseTip': "从 JSON 文件导入课程",
  'dashboard.importCourse': "导入课程",
  'dashboard.streak': "连续 {days} 天",
  'dashboard.dateFormat': "{y}年{m}月{d}日",
  'dashboard.preparing': "正在准备中",
  'dashboard.preparingEmpty': "课程已创建，请导入课件开始分析",
  'dashboard.preparingUploaded': "课件已经解析完成，可以继续让 AI 提炼考点",
  'dashboard.preparingAnalyzing': "AI 正在分析课件内容，提炼考点…",
  'dashboard.preparationPaused': "课程准备已暂停",
  'dashboard.preparingNeedsParsing': "课件文件已登记，但内容解析尚未完成",
  'dashboard.preparingParsing': "正在解析课件内容…",
  'dashboard.preparingParsingProgress': "正在解析课件：已完成 {current}/{total} 个文件",
  'dashboard.preparingBuilding': "已提炼 {count} 个考点，正在创建关卡…",
  'dashboard.preparationProgress': "课程准备进度",
  'dashboard.stageParse': "解析课件",
  'dashboard.stageExtract': "AI 提炼考点",
  'dashboard.stageBuild': "创建关卡",
  'dashboard.retryPreparation': "继续提炼考点",
  'dashboard.continuePreparation': "继续处理课程",
  'dashboard.backToImport': "返回导入课件",
  'dashboard.genBanner': "正在后台生成关卡内容... ({current}/{total})",
  'dashboard.cancelGeneration': "取消生成",
  'dashboard.resumeGeneration': "继续生成",
  'dashboard.generationPaused': "关卡内容生成已暂停（{current}/{total}）",
  'dashboard.untilExam': "距期末考试",
  'dashboard.editDate': "修改考试日期",
  'dashboard.edit': "修改",
  'dashboard.dayUnit': "天",
  'dashboard.sprintFinal': "冲刺关键期，加油！",
  'dashboard.examOngoing': "考试进行中",
  'dashboard.examDateLabel': "考试日期",
  'dashboard.examEnded': "考试已结束",
  'dashboard.examEndedDays': "已过去 {days} 天",
  'dashboard.examStats': "考点统计",
  'dashboard.totalPoints': "共 {count} 个考点",
  'dashboard.quickEntries': "快捷入口",
  'dashboard.continueStudy': "继续学习",
}

const en: Record<TranslationKey, string> = {
  ...progressEn,
  'search.placeholder': 'Search lessons or knowledge points',
  'search.noResults': 'No matching knowledge points',
  'search.resultMeta': '{course} · Lesson {order}',
  'search.matchLabel': 'Match: {text}',
  'search.clear': 'Clear search',
  'nav.dashboard': 'Home',
  'nav.upload': 'Import',
  'nav.lessons': 'Quests',
  'nav.wrongbook': 'Mistakes',
  'nav.chat': 'Athena',
  'nav.settings': 'Settings',
  'nav.levelUnit': 'Levels',
  'nav.generating': 'Generating...',
  'settings.title': 'Settings',
  'settings.subtitle': 'App info & preferences',
  'settings.appDesc': 'AI-powered quest-based finals prep assistant',
  'settings.statsCourses': 'Courses',
  'settings.statsFiles': 'Files',
  'settings.localInfo': 'Local Info',
  'settings.localInfoDesc': 'All app data is stored locally, no account login required',
  'settings.localDataTitle': 'Local Data Storage',
  'settings.localDataDesc': 'All courses, learning records and settings are saved on this device. Full functionality available offline',
  'settings.teacher': 'Identity',
  'settings.teacherDesc': 'Set your user identity',
  'settings.teacherToggle': 'I am a teacher',
  'settings.teacherOn': 'Enabled',
  'settings.teacherOff': 'Tap to enable',
  'settings.api': 'API Config',
  'settings.apiDesc': 'Model provider, API key and parameters',
  'settings.storage': 'Courseware storage',
  'settings.storageDesc': 'View courseware files, storage locations, and migration options',
  'settings.data': 'Data',
  'settings.dataDesc': 'Course data statistics and cleanup',
  'settings.about': 'About',
  'settings.aboutDesc': 'App info and contact details',
  'settings.appearance': 'Appearance & Language',
  'settings.appearanceDesc': 'Switch light/dark theme and select UI language',
  'settings.language': 'Language',
  'settings.theme': 'Appearance',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.uiFontSize': 'UI text size',
  'settings.uiFontSizeDesc': 'Adjust only interface text size without zooming or clipping the window.',
  'settings.uiFontSizeReset': 'Default',
  'settings.applied': 'Applied',
  'settings.applyLanguage': 'Apply Language',
  'about.subtitle': 'Learn about ChillPass and find contact details',
  'about.appInfo': 'App Info',
  'about.appName': 'App Name',
  'about.backToSettings': 'Back to settings',
  'about.joinUs': 'Join Us',
  'about.joinUsDesc': 'Add developer WeChat for feedback or collaboration',
  'about.wechat': 'WeChat',
  'about.copy': 'Copy',
  'about.copied': 'Copied',
  'titlebar.balance': 'Provider balance',
  'titlebar.balanceQuery': 'Check balance',
  'titlebar.balanceLoading': 'Loading',
  'titlebar.balanceUnavailable': 'Balance unavailable, click to retry',
  'titlebar.balanceRefresh': 'Refresh balance',
  'titlebar.balanceNoKey': 'No key',
  'titlebar.balanceUnsupported': 'N/A',
  'titlebar.providerSwitch': 'Switch provider',
  'titlebar.focusMode': 'Focus',
  'titlebar.exitFocus': 'Exit Focus',
  'common.back': 'Back',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'titlebar.minimize': 'Minimize',
  'titlebar.close': 'Close',
  'dashboard.welcome': 'Welcome back',
  'dashboard.noCourse': 'No courses yet',
  'dashboard.noCourseDesc': 'Import materials to start your prep journey',
  'dashboard.importBtn': 'Import Materials',
  'dashboard.countdown': 'Exam Countdown',
  'dashboard.daysLeft': 'days until exam',
  'dashboard.examToday': 'Exam today! Good luck!',
  'dashboard.setExamDate': 'Set exam date',
  'dashboard.progress': 'Progress',
  'dashboard.quickAsk': 'Ask Athena',
  'dashboard.quickImport': 'Import Materials',
  'dashboard.quickQuest': 'Quest Sprint',
  'upload.title': 'Import Materials',
  'upload.subtitle': 'Upload files, AI extracts topics and generates levels',
  'upload.courseName': 'Course Name',
  'upload.courseNamePlaceholder': 'Enter course name',
  'upload.examDate': 'Exam Date (optional)',
  'upload.selectFiles': 'Select Files',
  'upload.dragHere': 'Drag files here',
  'upload.modeCreate': 'New Course',
  'upload.modeAppend': 'Add to Existing',
  'upload.start': 'Start Import',
  'upload.importing': 'Importing...',
  'lessons.title': 'Quest Sprint',
  'lesson.keyPoints': 'Key Points',
  'lesson.examples': 'Examples',
  'lesson.quiz': 'Quiz',
  'lesson.complete': 'Complete',
  'lesson.nextPage': 'Next',
  'lesson.finish': 'Finish',
  'lesson.retry': 'Try Again',
  'lesson.changeQuestion': 'New Question',
  'lesson.submit': 'Submit',
  'lesson.correctAnswer': 'Correct Answer',
  'lesson.standardAnswer': 'Standard Answer',
  'lesson.showAnswer': 'Show answer',
  'lesson.hideAnswer': 'Hide answer',
  'lesson.answerViewed': 'Answer viewed',
  'lesson.answerViewHint': 'Viewing does not submit or grade your response, or add a mistake. You can still answer or skip.',
  'lesson.referenceUnavailable': 'No reference answer is available. Use Regenerate to get a new question.',
  'wrongbook.title': 'Mistake Notebook',
  'wrongbook.empty': 'No mistakes yet, keep going!',
  'wrongbook.yourAnswer': 'Your Answer',
  'wrongbook.correctAnswer': 'Correct Answer',
  'wrongbook.askAthena': 'Ask Athena',
  'wrongbook.mastered': 'Mastered',
  'wrongbook.clear': 'Clear',
  'athena.title': 'Athena',
  'athena.subtitle': 'Your smart study companion',
  'athena.thinking': 'Thinking...',
  'athena.basedOn': 'Based on "{course}"',
  'athena.idle': 'Idle',
  'athena.tasking': 'Working',
  'athena.abilities': 'Abilities',
  'athena.memories': 'Memories',
  'athena.taskQa': 'Ask Anything',
  'athena.taskPaper': 'Paper Writing',
  'athena.taskReport': 'Report Writing',
  'athena.taskSummary': 'Knowledge Summary',
  'athena.taskPlan': 'Study Plan',
  'athena.taskQaDesc': 'Ask any question anytime',
  'athena.taskPaperDesc': 'Structured academic writing',
  'athena.taskReportDesc': 'Formatted report writing',
  'athena.taskSummaryDesc': 'Systematic knowledge review',
  'athena.taskPlanDesc': 'Actionable study schedule',
  'athena.startTask': 'Start',
  'athena.inputPlaceholder': 'Type your question...',
  'athena.export': 'Export Athena',
  'athena.import': 'Import Athena',
  'onboarding.welcomeTitle': 'Welcome to ChillPass',
  'onboarding.welcomeSubtitle': 'Your AI study companion — from exam prep to paper writing',
  'onboarding.privacyNote': 'All data stays on your device. Fully offline, no sign-up, no tracking',
  'onboarding.languageLabel': 'Language',
  'onboarding.overviewTitle': 'Get started in three steps',
  'onboarding.step1Title': 'Configure API Key',
  'onboarding.step1Desc': 'Enter your DeepSeek API key to unlock all AI features',
  'onboarding.step2Title': 'Import courseware',
  'onboarding.step2Desc': 'Upload PDF / Word / PPTX / TXT / MD course materials',
  'onboarding.step3Title': 'AI builds your quest course',
  'onboarding.step3Desc': 'Exam points are extracted and turned into lessons, examples and quizzes',
  'onboarding.startTitle': 'Ready to go?',
  'onboarding.startDesc': 'Step one is configuring your DeepSeek API key — it takes about 2 minutes',
  'onboarding.goConfig': 'Configure API',
  'onboarding.prev': 'Back',
  'onboarding.next': 'Next',
  'onboarding.skip': 'Skip tour',
  'settings.reviewGuide': 'Replay getting started tour',
  'settings.reviewGuideDesc': 'Review the welcome information and basic setup entry point',
  'tokens.title': 'Token Usage',
  'tokens.desc': 'Model API calls made from this device',
  'tokens.total': 'Total Tokens',
  'tokens.today': 'Today',
  'tokens.calls': 'Calls',
  'tokens.prompt': 'Input',
  'tokens.completion': 'Output',
  'tokens.last7': 'Last 7 days',
  'tokens.reset': 'Reset stats',
  'tokens.resetConfirm': 'Clear all token usage statistics?',
    'tokens.empty': 'No API calls yet',
  'sidebar.courseManage': "Course management",
  'sidebar.importShort': 'Import',
  'sidebar.exportShort': 'Export',
  'sidebar.courseSearch': "Search courses",
  'sidebar.courseSearchEmpty': "No matching courses",
  'athena.conversation': "Conversation",
  'athena.newChat': "New chat",
  'athena.deleteChat': "Delete this conversation",
  'athena.messageCount': "{count} messages",
  'chat.svgSource': "View SVG source",
  'img.invalidFormat': "Could not read this image — please use PNG, JPEG, WebP or GIF",
  'img.tooLarge': "The image is too large to send even after compression — please use a smaller one",
  'athena.imageDirectSend': "The image will be sent straight to the multimodal model",
  'athena.visionUnsupported': "The current model {model} cannot read images — switch to a vision-capable model (e.g. deepseek-flash) in Settings",
  'lesson.review': "Review",
  'lesson.retryReview': "Retry review",
  'lesson.reviewTitle': "Doubt the answer key? Have the AI independently re-solve this question",
  'lesson.reviewRunning': "AI is independently double-checking this question…",
  'lesson.reviewFailed': "Review failed",
  'lesson.reviewYouWereRight': "Verdict: you were right",
  'lesson.reviewYouWereWrong': "Verdict: the answer key stands",
  'lesson.adjudicating': "Your answer differs from the reference answer — AI is double-checking this question…",
  'lesson.keyFixedNote': "Verdict: the reference answer on this question was wrong, and your answer is correct. The question has been fixed and will not be added to the mistake notebook.",
  'model.deepseekFlash': "deepseek-flash — V4.1 Flash, fast and low-cost, supports image understanding",
  'model.deepseekV4Pro': "deepseek-v4-pro — V4 Pro flagship, strongest reasoning for complex problems and long texts (no image support)",
  'model.deepseekV4FlashLegacy': "deepseek-v4-flash — legacy ID, still accepted but served by Flash",
  'model.deepseekVisionExp': "deepseek-v4-flash-vision-exp — experimental vision model, legacy ID",
  'model.deepseekChatLegacy': "deepseek-chat — retired on 2026-07-24, calls will fail; use deepseek-flash instead",
  'model.deepseekReasonerLegacy': "deepseek-reasoner — retired on 2026-07-24, calls will fail; use deepseek-flash instead",
  'model.customCompatible': "OpenAI-compatible model; edit this to the model ID your custom provider supports",
  'model.unknownDesc': "Available for your account (no built-in description)",
  'api.modelRefresh': "Load available models",
  'api.modelRefreshing': "Fetching…",
  'api.modelRefreshOk': "Fetched {count} available models from the provider",
  'api.modelRefreshFailed': "Fetch failed: {msg}",
  'api.modelNeedKey': "Fill in your API key above before loading models",
  'api.modelBuiltinHint': "Showing the built-in list — click \"Load available models\" to load what your account actually has",
  'api.modelLiveHint': "List fetched live from the provider",
  'api.modelHoverHint': "Hover an option to see its description",
  'athena.charterMemory': 'Charter Memory',
  'athena.flowMemory': 'Flow Memory',
  'wrongbook.subtitle': "Grouped by course — tackle them one by one",
  'app.docTitle': "ChillPass — Final Exam Sprint Assistant",
  'athena.memCategoryCustom': "Custom",
  'athena.noAbilitiesHint': "No abilities yet — Athena will discover new ones from your chats",
  'athena.autoTag': "Auto-discovered",
  'athena.charterMemoryHint': "Managed by you — Athena must follow and cannot change it",
  'athena.flowMemoryHint': "Managed automatically by Athena — records your preferences and study habits",
  'athena.noFlowMemoriesHint': "No flow memories yet — Athena will accumulate them from your chats",
  'titlebar.helpQrAlt': "ChillPass user group QR code",
  'api.subtitle': "Connect a model provider to extract exam points and generate lessons",
  'api.providerZhipu': "Zhipu GLM",
  'api.providerCustom': "Custom",
  'api.providerAddCustom': "Add custom provider",
  'api.providerDeleteCustom': "Delete custom provider",
  'api.providerDeleteConfirm': "Delete custom provider \"{name}\"? Its local API key, base URL and usage-query settings will also be removed.",
  'storage.resLocation': "Resource Storage Location",
  'storage.migration': "Resource Migration",
  'storage.defaultBadge': "Default",
  'storage.fileList': "Courseware File List",
  'storage.totalFiles': "{count} files total",
  'storage.totalSizeLabel': "Total size {size}",
  'storage.filesMissing': "{count} files missing",
  'storage.checkingFiles': "Checking files...",
  'storage.targetDir': "Target Directory",
  'storage.modeLabel': "Migration Mode",
  'storage.modeCopy': "Copy",
  'storage.modeMove': "Move",
  'storage.migratingProgress': "Migrating files... {percent}%",
  'storage.migratedCount': "Migrated: {count} files",
  'storage.migratedTotalSize': "Total migrated: {size}",
  'storage.targetDirResult': "Target directory: {dir}",
  'storage.firstRunTitle': "Choose courseware storage",
  'storage.firstRunDesc': "ChillPass stores original courseware files, extraction cache, and generated content on this device. Use the default folder or choose another drive/folder.",
  'storage.firstRunDefault': "Default location: {path}",
  'storage.firstRunUseDefault': "Use default",
  'storage.firstRunChoose': "Choose another folder",
  'storage.firstRunChoosing': "Choosing...",
  'account.editTitle': "Edit Profile",
  'account.createTitle': "Create Local Account",
  'account.modalSubtitle': "Account info stays on this device — offline, no internet needed",
  'account.offlineHintLogin': "This is a local offline account. All data stays in this browser and is never uploaded to any server.",
  'account.offlineHintEditor': "This is a local offline account. All data stays in this browser and is never uploaded to any server. You can export your account data to a new device in Settings.",
  'account.nameLabel': "Nickname *",
  'account.namePlaceholder': "Enter a nickname",
  'account.avatarLabel': "Avatar",
  'account.bioLabel': "Bio",
  'account.bioPlaceholder': "Describe yourself in one line (optional)",
  'account.nameRequired': "Please enter a nickname",
  'account.defaultName': "Learner",
  'account.pickAvatar': "Choose avatar {emoji}",
  'account.close': "Close",
  'account.createBtn': "Create account",
  'service.noApiKey': "No API Key set — configure it in Settings",
  'service.timeout': "Request timed out — check your connection and try again",
  'service.network': "Network connection failed — check your connection and try again",
  'service.apiError': "Model API error: {code} - {msg}",
  'service.retriesExhausted': "Request failed after {count} retries",
  'service.genLessonFailed': "Failed to generate lesson content — please try again",
  'service.emptyResponse': "The AI returned an empty response. Please try again.",
  'service.structuredOutputEmpty': "The AI returned an empty response",
  'service.structuredOutputTruncated': "The AI response was too long and was truncated",
  'service.structuredOutputInvalid': "The lesson JSON format or content structure returned by the AI was invalid",
  'service.lessonGenerationRetryFailed': "Lesson generation still failed after an automatic retry: {msg}",
  'service.regenQuestionFailed': "Failed to regenerate the question — please try again",
  'service.answerCorrectAll': "Perfect answer!",
  'service.answerCorrect': "Correct — all key points covered!",
  'service.answerPartial': "Partially correct ({matched}/{total} key points matched) — not complete yet. Reference answer: {answer}",
  'service.answerFeedbackOk': "Correct!",
  'service.answerFeedbackBad': "Incorrect",
  'service.answerUngradeable': "Could not grade this answer right now. Check the network or API configuration, then retry. Reference answer: {answer}",
  'service.fileNotFound': "The original course file could not be found. Return to Import and select it again. (File ID: {id})",
  'service.fileKeyMissing': "The original course file was not saved. Return to Import and select it again.",
  'parse.unsupportedFormat': "Unsupported file format: {ext}",
  'parse.apiUnavailable': "File API unavailable",
  'parse.docxNoXml': "Cannot read the Word document (document.xml missing) — make sure it is a valid .docx",
  'parse.docxNoText': "No text could be extracted from the Word document",
  'parse.docIsRtf': "This file is actually RTF — save it as .docx in Word and import again",
  'parse.docNoStream': "Cannot read the Word document (WordDocument stream missing)",
  'parse.docInvalid': "Not a valid Word 97-2003 document",
  'parse.docNoText': "No valid text extracted from the DOC file — save it as .docx in Word and import again",
  'parse.docInvalidOle': "Not a valid Word 97-2003 document (OLE compound header missing)",
  'img.apiUnavailable': "Cannot read the file — file API unavailable",
  'model.glmFlash': "glm-5.3-flash (fast response, great value)",
  'model.glm53': "glm-5.3 (flagship, more capable)",
  'mock.dirDialogPrompt': "Directory selection is not supported in browser mode — files are stored in browser IndexedDB",
  'mock.userDataPath': "Browser IndexedDB storage",
  'mock.closeConfirm': "Close the app?",
  'mock.installPath': "Not installed (web preview mode)",
  'mock.userDataBrowser': "Browser IndexedDB / localStorage",
  'mock.tempPath': "Browser memory",
  'mock.installPathAlert': "Web preview mode: app not installed, cannot locate the install path",
  'mock.noReleaseNotes': "No release notes",
  'mock.updateServerUnreachable': "Cannot reach the update server — check your network and try again ({msg})",
  'common.unknownError': "Unknown error",
  'storage.migrateFailedRetry': "Migration failed, please retry",
  'storage.cardDesc': "View courseware files, storage locations, and migration options",
  'storage.dirHint': "Original course files are stored here. A new folder applies to new imports; existing files remain readable in their previous folders. Lessons and answers stay in browser storage.",
  'storage.browserDirHint': "Files use the selected folder, falling back to browser storage if writing fails. Changing folders applies to new files; existing files remain readable.",
  'storage.browserFilesTitle': "Courseware files",
  'storage.browserFileDesc': "These are courseware files recorded by the app. You can add files in Explorer, then scan the course folder manually from Import.",
  'storage.browserToFolderTitle': "Migrate old browser files",
  'storage.browserToFolderHint': "{count} browser-stored files can be copied to the current resource folder. Paths update only after verification succeeds.",
  'storage.browserToFolderAction': "Migrate to ChillPass folder",
  'storage.browserAlreadyMigrated': "Current course file paths already point to local folders. No migration needed.",
  'storage.localBackendUnavailable': "Local file service is unavailable. Open the installed app or the local dev server.",
  'storage.gettingPath': "Getting default path...",
  'storage.selecting': "Selecting...",
  'storage.selectDir': "Choose directory",
  'storage.resetDefault': "Reset to default",
  'storage.migrateDesc': "Move all course files to the target directory to free up C: space. File paths inside the app update automatically afterwards.",
  'storage.noFiles': "No courseware files yet — upload materials on the Import page first",
  'storage.noTarget': "No target directory selected",
  'storage.selectTarget': "Choose target directory",
  'storage.moveMode': "Move mode: files are transferred to the target directory, maximally freeing the original location.",
  'storage.copyMode': "Copy mode: files are copied to the target directory, originals kept.",
  'storage.migrateDone': "Migration complete",
  'storage.migrateFailed': "Migration failed",
  'storage.pathUpdated': "{count} file paths updated automatically — the list above now shows the new paths.",
  'storage.migrating': "Migrating...",
  'storage.startMigrate': "Start migration",
  'data.title': "Data management",
  'data.subtitle': "Manage locally stored courses and study data",
  'data.statsTitle': "Statistics",
  'data.statsDesc': "See how many courses and files are stored locally",
  'data.courseCount': "Courses",
  'data.storageTitle': "Storage info",
  'data.storageDesc': "Data location and disk usage",
  'data.installPath': "Install location",
  'data.loading': "Loading...",
  'data.locateTip': "Locate the install folder in Explorer",
  'data.locate': "Locate",
  'data.userDataPath': "Data location",
  'data.diskUsage': "Disk usage",
  'data.courseDataApprox': "course data ≈ {size}",
  'data.byCourse': "Usage by course",
  'data.dangerTitle': "Danger zone",
  'data.dangerDesc': "Only courses, cached courseware, exam points, wrong questions and quest progress are deleted. API keys, model, theme, language and font-size settings are kept.",
  'data.clearAll': "Clear all course data",
  'data.clearConfirm': "Clear all course data? This is permanent, but API keys, model, theme, language and font-size settings will be kept.",
  'data.confirmClear': "Confirm clear",
  'api.cardTitle': "Model access",
  'api.cardDesc': "Configure your API key and model. All data stays local and is never uploaded to third parties",
  'api.provider': "Provider",
  'api.hintZhipu': "Uses the Zhipu AI platform — China-friendly; glm-5.3-flash is fast",
  'api.hintDeepseek': "Uses the DeepSeek model — great for exam-point reasoning and content generation",
  'api.hintCustom': "Uses an OpenAI-compatible endpoint. Fill in the API key, base URL and model ID.",
  'api.hintOpenAICompat': "Uses an OpenAI-compatible API. You can adjust the base URL and model list for each provider.",
  'api.customNameLabel': "Provider name",
  'api.customNamePlaceholder': "e.g. Claude official / OpenAI-compatible proxy",
  'api.customBaseUrlLabel': "API Base URL",
  'api.customBaseUrlPlaceholder': "e.g. https://api.example.com/v1",
  'api.customBaseUrlHint': "Enter the OpenAI-compatible root such as /v1. ChillPass appends /chat/completions and /models automatically.",
  'api.customBaseUrlRequired': "Enter the custom provider API Base URL first",
  'api.customUsageEnabled': "Enable custom usage query",
  'api.customUsageOptionalTitle': "Usage query (optional)",
  'api.customUsageOptionalDesc': "Only affects the top-right balance display. Content generation works without it.",
  'api.customUsageHint': "Used by the top-right balance/quota button. The script runs locally and should return remaining or total/used fields.",
  'api.customUsageScript': "Usage query script",
  'api.customUsageReset': "Reset sample",
  'api.customUsageVars': "Available variables: {{baseUrl}}, {{apiKey}}. extractor(response) returns isValid, remaining, unit, total, used, extra.",
  'api.keyLabel': "API Key",
  'api.keyPhZhipu': "Enter your Zhipu API key",
  'api.keyPhDeepseek': "Enter your DeepSeek API key",
  'api.keyPhCustom': "Enter your custom provider API key",
  'api.hideKey': "Hide API key",
  'api.showKey': "Show API key",
  'api.keyHintZhipu': "Get it from the Zhipu open platform. Stored locally only",
  'api.keyHintDeepseek': "Get it from the DeepSeek open platform. Stored locally only",
  'api.keyHintCustom': "Use this provider's key. Stored locally only",
  'api.linkZhipu': "Get an API key from the Zhipu platform",
  'api.linkDeepseek': "Get an API key from the DeepSeek platform",
  'api.modelLabel': "Model",
  'api.modelHintZhipu': "glm-5.3-flash is fast; glm-5.3 handles complex exam-point reasoning",
  'api.modelHintDeepseek': "deepseek-chat is fast; deepseek-reasoner handles complex reasoning",
  'api.save': "Save settings",
  'athena.fLevel': "Academic level",
  'athena.fLevelPh': "e.g. bachelor / master / course paper",
  'athena.fReportTopic': "Report topic",
  'athena.fReportTopicPh': "e.g. lab report / research report",
  'athena.fReportType': "Report type",
  'athena.fReportTypePh': "e.g. lab / research / book report",
  'athena.fSummaryScope': "Summary scope",
  'athena.fSummaryScopePh': "e.g. chapters 1-3 / all courseware",
  'athena.fOutputFormat': "Output format",
  'athena.fOutputFormatPh': "e.g. table / mind map / list",
  'athena.noReply': "Sorry, I didn't receive a reply. Please try again.",
  'athena.unknownError': "An unknown error occurred",
  'athena.errorPrefix': "Error: {msg}",
  'athena.statusThinking': "Thinking",
  'athena.statusTasking': "Working on task",
  'athena.clearChat': "Clear chat",
  'athena.openFullChat': "Open full chat",
  'layout.showNavigation': 'Show navigation',
  'layout.hideNavigation': 'Hide navigation',
  'athena.showSidebar': 'Open Athena side chat',
  'athena.hideSidebar': 'Hide Athena side chat',
  'athena.expandPanel': 'Expand chat',
  'athena.restorePanel': 'Exit expanded chat',
  'athena.sidebarDescription': 'Ask as you learn. Conversations are saved automatically.',
  'athena.welcomeMsg': "I'm your AI study companion — pick a task to start",
  'athena.currentTask': "Current task: {task}",
  'athena.attachedImage': "Attached image",
  'athena.attachedFile': "Attached file",
  'athena.removeImage': "Remove image",
  'athena.insertImage': "Insert image",
  'athena.addAttachment': "Add attachment",
  'athena.dropAttachments': "Drop to attach",
  'athena.fileTextReady': "File text will be sent as context",
  'athena.fileMetaOnly': "Only file info can be sent",
  'athena.attachmentProcessing': "Processing attachment",
  'athena.attachmentProcessingHint': "Compressing image or parsing document...",
  'athena.attachmentOnlyPrompt': "Please check the attachments: {files}",
  'athena.thinkingPlaceholder': "Athena is thinking...",
  'athena.taskInputHint': "{task} - type and press Enter to send",
  'athena.chatInputHint': "Type your question — Enter to send, Shift+Enter for a new line",
  'athena.send': "Send",
  'athena.infoCollect': "Details",
  'athena.unspecified': "Not specified",
  'athena.taskPromptPrefix': "Please complete the task using the following details:",
  'athena.abilityNamePlaceholder': "Ability name (e.g. Paper writing)",
  'athena.abilityDescPlaceholder': "Ability description",
  'athena.add': "Add",
  'athena.importSuccess': "Athena config imported!",
  'athena.addCharterMemory': "Add a new charter memory...",
  'athena.edit': "Edit",
  'athena.fTopic': "Paper topic",
  'athena.fTopicPh': "e.g. The impact of AI on higher education",
  'athena.fWords': "Word count",
  'athena.fWordsPh': "e.g. 3000 words",
  'athena.fWordsReportPh': "e.g. 2000 words",
  'athena.fSpecial': "Special requirements",
  'athena.fSpecialPh': "e.g. references required, specific format",
  'athena.fSpecialReportPh': "e.g. data charts required",
  'athena.fSummaryFocus': "Summary focus",
  'athena.fSummaryFocusPh': "e.g. key formulas, core concepts",
  'athena.fExamDate': "Exam date",
  'athena.fExamDatePh': "e.g. 2026-07-01",
  'athena.fDailyTime': "Daily study time",
  'athena.fDailyTimePh': "e.g. 3 hours",
  'athena.fWeakAreas': "Weak areas",
  'athena.fWeakAreasPh': "e.g. chapters 3-5 are hard",
  'athena.fMastered': "Already mastered",
  'athena.fMasteredPh': "e.g. chapters 1-2 already reviewed",
  'teacher.qTypeCalculation': "Calculation",
  'teacher.qTypeEssay': "Essay",
  'teacher.diffEasy': "Easy",
  'teacher.diffMedium': "Medium",
  'teacher.diffHard': "Hard",
  'teacher.errPrintWindow': "Could not open the print window",
  'teacher.errSelectCourse': "Please select a course first",
  'teacher.errNoCourseware': "This course has no courseware text — import and analyze courseware first",
  'teacher.errGenerate': "Generation failed, please retry (network issue or not enough courseware content)",
  'teacher.errGenerateShort': "Generation failed, please retry",
  'teacher.clearConfirm': "Clear all generated questions?",
  'teacher.errExportEmpty': "Generate questions before exporting",
  'teacher.errTranslate': "Translation failed — exporting with the original content",
  'teacher.defaultPaperTitle': "{course} Final Exam",
  'teacher.courseFallback': "Course",
  'teacher.title': "Teacher Workspace",
  'teacher.subtitle': "Generate questions from courseware, assemble an exam and export PDF",
  'teacher.selectCourse': "Select a course",
  'teacher.selectCourseDesc': "Pick a course with imported courseware as the question source",
  'teacher.noCourses': "No courses yet — import courseware first",
  'teacher.charsCount': "{n} chars",
  'teacher.noText': "No text",
  'teacher.generate': "Generate questions",
  'teacher.generateDesc': "Choose type, difficulty and count — AI generates questions from the courseware",
  'teacher.fieldQType': "Question type",
  'teacher.fieldDifficulty': "Difficulty",
  'teacher.fieldCount': "Count",
  'teacher.countHint': "questions (1-50)",
  'teacher.generating': "Generating...",
  'teacher.generateBtn': "Generate questions",
  'teacher.listTitle': "Question list",
  'teacher.listSummary': "{count} questions, {points} points total",
  'teacher.groupSummary': "{count} questions · {points} points",
  'teacher.pointsUnit': "pts",
  'teacher.labelOptions': "Options:",
  'teacher.labelCorrect': "Correct",
  'teacher.labelAnswer': "Answer:",
  'teacher.labelSteps': "Solution steps:",
  'teacher.labelAcceptable': "Acceptable answers:",
  'teacher.labelExplanation': "Explanation:",
  'teacher.assemble': "Assemble & export exam",
  'teacher.assembleDesc': "Set the title, duration and language, then export as PDF for printing",
  'teacher.assembleTranslateHint': "(non-Chinese languages are translated automatically before export)",
  'teacher.fieldPaperTitle': "Exam title",
  'teacher.fieldDuration': "Duration (minutes)",
  'teacher.fieldLanguage': "Exam language",
  'teacher.summaryQuestions': "{count} questions",
  'teacher.summaryDuration': "{count} minutes",
  'teacher.translatingExport': "Translating and exporting...",
  'teacher.exportPdf': "Export as PDF",
  'lesson.notFound': "Lesson not found or removed",
  'lesson.backToList': "Back to lesson list",
  'lesson.noExamPoint': "Exam point info not found",
  'lesson.genFailedRetry': "Content generation failed, please retry",
  'lesson.gradeFailed': "Grading failed, please retry",
  'lesson.regenerateFailed': "Question regeneration failed, please retry",
  'lesson.orderLabel': "Lesson {n}",
  'lesson.regenerating': "Regenerating lesson content...",
  'lesson.tabPoints': "Key points",
  'lesson.explanationTitle': "Detailed explanation",
  'lesson.noExamples': "No worked examples in this lesson",
  'lesson.exampleN': "Example {n}",
  'lesson.stepsLabel': "Solution steps",
  'lesson.answerLabel': "Answer",
  'lesson.noQuiz': "No quiz questions in this lesson",
  'lesson.questionN': "Question {cur} / {total}",
  'lesson.qTypeChoice': "Single choice",
  'lesson.qTypeMulti': "Multiple choice",
  'lesson.qTypeFill': "Fill in the blank",
  'lesson.qTypeShort': "Short answer",
  'lesson.yourAnswerPlaceholder': "Enter your answer",
  'lesson.answerCorrect': "Correct!",
  'lesson.answerWrong': "Wrong answer",
  'lesson.answerUngradeable': "Not graded yet",
  'lesson.retryGrading': "Retry grading",
  'lesson.regenerateTitle': "Generate a new question on the same point",
  'lesson.regenerate': "Regenerate",
  'lesson.regenerateContent': "Improve lesson content",
  'lesson.regenerateContentHint': "Current content is replaced only after success; lesson progress is preserved",
  'lesson.confirmRegenerate': "Confirm regeneration",
  'lesson.restorePrevious': "Restore previous version",
  'lesson.regenerateSuccess': "New content generated; the previous version can still be restored",
  'lesson.regenerateCancelled': "Lesson improvement cancelled. The original content was kept.",
  'lesson.restoreSuccess': "Previous content and answer progress restored",
  'lesson.skipTitle': "Jump to the next question",
  'lesson.skipCost': "Skip",
  'lesson.tryAgain': "Try again",
  'lesson.submitWithCount': "Submit ({count} selected)",
  'lesson.grading': "Grading...",
  'lesson.completed': "Lesson completed",
  'lesson.generatingWait': "Content is being generated, please wait...",
  'lesson.genFailedManual': "Lesson content failed to generate — you can try regenerating manually.",
  'wrongbook.clearConfirm': "Clear all mistakes for \"{name}\"? This cannot be undone.",
  'wrongbook.noAnswer': "Not answered",
  'wrongbook.unknown': "Unknown",
  'wrongbook.prefillChoice': "I got a wrong answer in the lesson \"{lesson}\":\nQuestion: {question}\nI chose: {my}\nCorrect answer: {correct}\nPlease help me understand this point.",
  'wrongbook.prefillText': "I got a wrong answer in the lesson \"{lesson}\":\nQuestion: {question}\nMy answer: {my}\nReference answer: {correct}\nPlease help me understand this point.",
  'wrongbook.keepGoing': "Keep it up!",
  'lessons.defaultGroup': "Default group",
  'lessons.emptyTitle': "No quest path yet",
  'lessons.emptyDesc': "Import courseware first — AI will build your exam-point quest path",
  'lessons.goImport': "Import courseware",
  'lessons.groupProgress': "{done}/{count} done",
  'lessons.statusDone': "Completed",
  'lessons.statusLocked': "Locked",
  'lessons.tapStart': "Tap to start",
  'lessons.batchRegenerate': "Improve course",
  'lessons.batchConfirmTitle': "Find omissions and improve all lessons?",
  'lessons.batchConfirmDesc': "The original courseware is scanned again to add only missing points, then all lesson content is improved. Existing lessons, completion status and progress are preserved, and previous lesson versions remain restorable.",
  'lessons.batchStart': "Start batch improvement",
  'lessons.batchCancel': "Cancel",
  'lessons.batchProgress': "Improving {current}/{total}: {title}",
  'lessons.batchScanning': "Scanning the original courseware for missing points…",
  'lessons.batchScanFailed': "; missing-point scan failed, but existing lessons were still improved",
  'lessons.batchResult': "Batch complete: {added} added, {success} content updates succeeded, {failed} failed{scanStatus}",
  'lessons.batchCancelled': "Batch improvement cancelled. Completed lesson updates were kept.",
  'lessons.batchFailed': "Batch improvement failed. Please try again.",
  'lessons.rebuildStructure': "Rebuild structure",
  'lessons.rebuildConfirmTitle': "Rescan and rebuild the lesson structure?",
  'lessons.rebuildConfirmDesc': "The courseware will be extracted again and lessons will be rebuilt with a new recommended count. The number of lessons may increase or decrease. Matching existing lesson content and completion status are kept; unmatched new lessons need generation.",
  'lessons.rebuildStart': "Start rebuild",
  'lessons.rebuildRunning': "Re-extracting and rebuilding the lesson structure…",
  'lessons.rebuildResult': "Rebuild complete: {before} lessons → {after} lessons, reused {reused} generated lessons, {pending} pending.",
  'lessons.rebuildFailed': "Failed to rebuild the lesson structure. Check the courseware and try again.",
  'lessons.clearCompleted': "Clear completed",
  'lessons.clearCompletedConfirmTitle': "Clear completed progress?",
  'lessons.clearCompletedConfirmDesc': "Only completed lessons in the current course are reset to learnable. Generated content, questions, courseware, mistakes and API settings are kept.",
  'lessons.clearCompletedStart': "Clear progress",
  'lessons.clearCompletedDone': "Completed progress cleared. You can start again.",
  'titlebar.restore': "Restore",
  'titlebar.maximize': "Maximize",
  'titlebar.help': "Help",
  'titlebar.helpTitle': "ChillPass",
  'titlebar.helpIntroTitle': "How to use",
  'titlebar.helpIntroBody': "ChillPass turns courseware into lesson quests. Pick or import a course, generate lessons, then study while the rest continues in the background. Mistakes go to the mistake book, and course files are stored in your local ChillPass folder.",
  'titlebar.helpQuickTitle': "Common workflow",
  'titlebar.helpItem1T': "Pick a course",
  'titlebar.helpItem1D': "Switch the current course at the lower left. Importing into an existing course follows the current course",
  'titlebar.helpItem2T': "Import files",
  'titlebar.helpItem2D': "In Import Courseware, create a course or append to an existing one. PDF / Word / images are supported",
  'titlebar.helpItem3T': "Generate lessons",
  'titlebar.helpItem3D': "After generation starts, use the top progress icon to check parsing and lesson status. Finished lessons can be studied first",
  'titlebar.helpItem4T': "Start studying",
  'titlebar.helpItem4D': "Open Quest Sprint to study by lesson. You can submit, skip, regenerate, or view the answer directly",
  'titlebar.helpItem5T': "Review mistakes",
  'titlebar.helpItem5D': "Wrong answers appear in Mistakes. Review them by course and mark them mastered",
  'titlebar.helpItem6T': "Manage data",
  'titlebar.helpItem6D': "Settings shows local storage, course folders and font size. Clearing course data keeps API keys and preferences",
  'titlebar.helpItem7T': "AI tutor",
  'titlebar.helpItem7D': "The Athena agent handles paper writing, knowledge summaries and other task workflows",
  'titlebar.helpItem8T': "Teacher workspace",
  'titlebar.helpItem8D': "Enable \"Teacher mode\" in Settings to generate exam papers and export PDF",
  'titlebar.helpItem10T': "Focus mode",
  'titlebar.helpItem10D': "Click the top-right button for a fullscreen focus mode without distractions",
  'titlebar.helpContactTitle': "Contact the developer",
  'titlebar.helpWechat': "WeChat",
  'titlebar.helpVersionLabel': "Version",
  'titlebar.helpVersionValue': "CYRicky personal build",
  'titlebar.helpQrText': "Scan to join the ChillPass user group",
  'titlebar.helpGotIt': "Got it",
  'sidebar.workspace': "Workspace",
  'upload.pageSubtitle': "Upload your course materials — AI extracts exam points and builds a quest path",
  'upload.stEmpty': "Empty",
  'upload.stUploaded': "Uploaded",
  'upload.stAnalyzing': "Analyzing",
  'upload.stReady': "Ready",
  'upload.errPickFile': "Failed to pick files, please retry",
  'upload.errNameRequired': "Please enter a course name",
  'upload.errFilesRequired': "Please add at least one courseware file",
  'upload.parsing': "Parsing courseware...",
  'upload.errDuplicateName': "A course with this name exists. Use another name or append via \"Import into existing course\"",
  'upload.parsingFile': "Parsing {name} ({i}/{n})",
  'upload.extracting': "Extracting exam points and building the quest path...",
  'upload.doneJump': "Import complete! Redirecting...",
  'upload.parseFailed': "Parsing failed, please retry",
  'upload.errSelectCourse': "Please select a course to import into",
  'upload.errCourseMissing': "The selected course no longer exists. Please choose again",
  'upload.errOptimizationBusy': "This course is being improved. Finish or cancel it before appending courseware",
  'upload.parsingAppend': "Parsing new courseware...",
  'upload.allSkipped': "All files overlap too much with existing content — skipped",
  'upload.extractingAppend': "Extracting exam points from the new courseware...",
  'upload.newFilesCount': "{count} new files",
  'upload.merging': "Merging exam points and creating new lessons...",
  'upload.appendDone': "Append import complete! Redirecting...",
  'upload.processing': "Processing...",
  'upload.startAppend': "Append import",
  'upload.modeAppendFull': "Import into existing",
  'upload.appendTip': "Append new courseware to an existing course",
  'upload.noExisting': "No existing courses",
  'upload.appendModeHint': "No existing courses — append import is unavailable",
  'upload.courseNameExample': "e.g. Advanced Mathematics II",
  'upload.selectExisting': "Select an existing course",
  'upload.selectedInfo': "Selected: {name} · {points} exam points · {lessons} lessons",
  'upload.dropAppend': "Choose new courseware files to append, or drop them here",
  'upload.dropCreate': "Click to choose files, or drop them here",
  'upload.dropzoneHint': "Supports PDF, Word (doc/docx), PPTX, TXT, Markdown",
  'upload.removeFile': "Remove file",
  'upload.goConfig': "Configure",
  'upload.skipped': "Skipped {count} duplicate files: {names}",
  'upload.scanCourseFolder': "Scan course folder",
  'upload.openCourseFolder': "Open course folder",
  'upload.noNewFolderFiles': "No new courseware files found in the course folder",
  'upload.courseFolderReady': "Course folder created: {path}",
  'upload.stepParse': "Parse",
  'upload.stepPath': "Build path",
  'dashboard.badge': "ChillPass · Exam Sprint Assistant",
  'dashboard.heroTitle': "Start your exam sprint",
  'dashboard.heroSubtitle': "Upload courseware — AI extracts exam points and builds a quest-style sprint course",
  'dashboard.stepExtract': "Extract exam points",
  'dashboard.stepQuest': "Quest sprint",
  'dashboard.statusEmpty': "No files",
  'dashboard.statusUploaded': "Imported",
  'dashboard.statusAnalyzing': "Analyzing",
  'dashboard.statusReady': "Ready",
  'dashboard.priorityMust': "Must-know",
  'dashboard.priorityHigh': "High-freq",
  'dashboard.priorityKnow': "Awareness",
  'dashboard.deleteConfirm': "Delete course \"{name}\"? This cannot be undone.",
  'dashboard.importFailedFormat': "Import failed: invalid file format",
  'dashboard.importSuccess': "Course imported!",
  'dashboard.importDuplicate': "This course already exists (duplicate name or exam points). Switched to the existing one.",
  'dashboard.importFailedParse': "Import failed: could not parse the JSON file",
  'dashboard.importFailedRead': "Import failed: error reading the file",
  'dashboard.renameCourse': "Rename course",
  'dashboard.exportCourse': "Export course",
  'dashboard.deleteCourse': "Delete course",
  'dashboard.newCourse': "New course",
  'dashboard.importCourseTip': "Import a course from a JSON file",
  'dashboard.importCourse': "Import course",
  'dashboard.streak': "{days}-day streak",
  'dashboard.dateFormat': "{m}/{d}/{y}",
  'dashboard.preparing': "Preparing",
  'dashboard.preparingEmpty': "Course created. Import courseware to start the analysis",
  'dashboard.preparingUploaded': "Courseware parsing is complete. Continue with AI exam-point extraction",
  'dashboard.preparingAnalyzing': "AI is analyzing the courseware and extracting exam points…",
  'dashboard.preparationPaused': "Course preparation paused",
  'dashboard.preparingNeedsParsing': "The courseware is registered, but content parsing has not finished",
  'dashboard.preparingParsing': "Parsing courseware content…",
  'dashboard.preparingParsingProgress': "Parsing courseware: {current}/{total} files completed",
  'dashboard.preparingBuilding': "Extracted {count} exam points. Building lessons…",
  'dashboard.preparationProgress': "Course preparation progress",
  'dashboard.stageParse': "Parse files",
  'dashboard.stageExtract': "AI extraction",
  'dashboard.stageBuild': "Build lessons",
  'dashboard.retryPreparation': "Retry exam-point extraction",
  'dashboard.continuePreparation': "Continue processing",
  'dashboard.backToImport': "Back to courseware import",
  'dashboard.genBanner': "Generating lesson content in background... ({current}/{total})",
  'dashboard.cancelGeneration': "Cancel generation",
  'dashboard.resumeGeneration': "Resume generation",
  'dashboard.generationPaused': "Lesson generation paused ({current}/{total})",
  'dashboard.untilExam': "Until the final exam",
  'dashboard.editDate': "Change exam date",
  'dashboard.edit': "Edit",
  'dashboard.dayUnit': "days",
  'dashboard.sprintFinal': "Final sprint — you've got this!",
  'dashboard.examOngoing': "Exam is on",
  'dashboard.examDateLabel': "Exam date",
  'dashboard.examEnded': "Exam finished",
  'dashboard.examEndedDays': "{days} days ago",
  'dashboard.examStats': "Exam point stats",
  'dashboard.totalPoints': "{count} exam points in total",
  'dashboard.quickEntries': "Quick actions",
  'dashboard.continueStudy': "Continue learning",
}

const translations: Record<Language, Record<TranslationKey, string>> = {
  zh, en,
}

export function translate(lang: Language, key: TranslationKey): string {
  return translations[lang]?.[key] ?? translations.zh[key] ?? key
}
