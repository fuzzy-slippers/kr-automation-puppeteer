#!/usr/bin/env node
const puppeteer = require(`puppeteer`);
const fs = require(`fs`);
const path = require(`path`).posix;

// change to argument value with default value false
const useHeadlessInvisibleBrowserObj = {headless: true}; 
const wordToLookForInURLToIdentifySSORedirect = `idpselection`;
const jpegQualityOutOfHundred = 10;

// using yargs to handle command line options and auto-generate help menu of the options
// specifically specifying a JSON file indicating what we are trying automated and the KR records to update
const argv = require('yargs/yargs')(process.argv.slice(2))
  .config(`jsonconfigfile`, function (configPath) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  })
  .option(`jsonconfigfile`, {
    alias: `j`,
    describe: `path to a json config file containing: root KR URL, array of proposals, etc `
  })
  .demandOption([`jsonconfigfile`], `Please include the path via jsonconfigfile= to a json file containing the records in KR to open NOTE: npm run start not working with the args, use node <appname.js> instead`)
  .argv;


(async () => {
  if (confirmJsonConfigFileContainsAllNeededElements(argv)) {
    const pathOfScreenshotDirInsideConfigFolder = createDirectoryToHoldScreenshots(argv.jsonconfigfile);
    const pathToSecurityRelatedDirectory = createDirIfDoesntExistAndGetPath(`./security_related`);

    await launchVisibleBrowserSSOLoginSaveCookies(argv.urlToTriggerSSOLogin, argv.howLongToWaitForSSOLogin, pathToSecurityRelatedDirectory);

    const browserForAutomation = await launchBrowserWithSSOCookies(pathToSecurityRelatedDirectory, useHeadlessInvisibleBrowserObj);

    switch (argv.automationTask) {
      case `cancelPropDevProposals`:
        await doAutomationCancelListPropDevProposals(browserForAutomation, argv.leftPortionOfKRDirectLinkToModule, argv.recordNumsToUpdateInKRArr, argv.isKrUsingNewDashboardWithIframes, pathOfScreenshotDirInsideConfigFolder);
        break;
      default:
        throw new Error(`the json config must specify a automationTask as one of the fields so the program knows which automation to perform`);
    }
  }
  else {
    throw new Error(`Exiting the program as the JSON config file (required to be passed in) is missing needed fields to run the program`);
  }
})();

  /**
   * Make sure that the JSON file passed in on the command line using yargs has all the needed elements
   *
   * We want to make sure the JSON file contains elements for what to automate, which KR instance to use (SBX/STG, greendale-sbx) , etc and which records in KR to update
   * if all the various top level parts of the json config file are detected, return true to indicate all seemed to be ok with the json config file
   * if any of the listed top level fields are missing, output the portions missing in the json config file with a message to standard error
   * @param {Object}   argv   The argv object passed through the yargs node library that parses a json config file
   *
   * @return {Boolean} if the passed in JSON config file is missing any of the fields needed return false
   */
  function confirmJsonConfigFileContainsAllNeededElements(argv) {
    console.info(`INFO:argv parsed from the JSON is: ${JSON.stringify(argv)}`);
    if (!argv.automationTask) {
      console.error(`ERROR:The config JSON file passed in must have a automationTask string that indicates the type of automation for the program to do - this allows the same program to do a list of different automations (cancel proposals, change award statuses, etc)`);
    }    
    else if (!argv.urlToTriggerSSOLogin) {
      console.error(`ERROR:The config JSON file passed in must have a urlToTriggerSSOLogin string listing the URL to open to force you to log in via SSO so the rest of the pages opened do not require login`);
    }
    else if (!argv.howLongToWaitForSSOLogin) {
      console.error(`ERROR:The config JSON file passed in must have a howLongToWaitForSSOLogin numeric value present which is the number of milliseconds to wait to get all logged in via SSO/MFA before attempting to start the automation - for example 18000 which is 18 seconds`);
    }  
    else if (!argv.hasOwnProperty(`isKrUsingNewDashboardWithIframes`)) {
      console.error(`ERROR:The config JSON file passed in must have a isKrUsingNewDashboardWithIframes true/false value to indicate if the new KR dashboard is enabled - the automation handles iframes differently with and without the dashboard on`);
    }
    else if (!argv.leftPortionOfKRDirectLinkToModule) {
      console.error(`ERROR:The config JSON file passed in must have a leftPortionOfKRDirectLinkToModule string listing the left portion of the direct link to the KR record, for example https://usmd-stg.kuali.co:/res/kc-common/development-proposals/ minus the prop dev number if currently doing automation on KR Prod Dev records`);
    }
    else if (!argv.recordNumsToUpdateInKRArr || !argv.recordNumsToUpdateInKRArr[0]) {
      console.error(`ERROR:The config JSON file passed in must have a recordNumsToUpdateInKRArr array with at least one element, listing the record numbers (PD numbers, etc) that go at the end of the direct link in KR to identify a particular record to load - these are the way to specify which records to do automated data entry against`);
    }  
    else {
      return true;
    }
  }

 /**
   * Record to disk the cookies from the presently open browser session to the path specified so that we can open additional browser sessions without needing to log in again.
   *
   * Having a browser object passed in as that is what the calling function typically has available, so just lookup the page object of the first tab which then allows us to get the cookies.
   * Stores the cookies as a JSON file hard coded as "cookies.json" but with the path being passed in - planning to use a special security related folder that will be in the gitignore so that it wont be checked into version control, but the path will be handled at the level of the function that calls this, just specifying the folder once it's been created/determined
   * I had explored using temporary environment variables as an alternative but node does not appear to be able to write out environment variable data to the operating system, so that didn't seem like it could be viable, so went with saving to disk as all the examples I could find of puppeteer cookies were doing.

   * @param {Object}   browser    The main Puppeteer browser object, will be needed to inspect the current list of iframes and potentially open new tabs
   * @param {string}    dirToStoreCookies The path of the folder to use to store the cookies.json file this function creates - the folder is passed in and handled outside of this function although the plan is for it to be a folder that is listed in the gitignore file so that the cookies wont be checked into version control - for example a "security_related" folder that is only used locally - decided to pass this in as the same path would be used in the function to retrieve the cookies as well, so not great to duplicate that code multiple places
   */
  async function saveCopyOfCookiesEnvironmentVar(browser, dirToStoreCookies) {
    const pageTab1 = (await browser.pages())[0];
    const cookies = await pageTab1.cookies();
    const cookieJson = JSON.stringify(cookies);
    console.info(`INFO: the browser cookieJson is showing: 
    ${cookieJson}`);
    fs.writeFileSync(`${dirToStoreCookies}/cookies.json`, cookieJson)

  }
 /**
   * Launches a new chromium browser with all cookies loaded in (in case sessions are still active from the last browser launched by the program)
   *
   * The name of the cookies file is always cookies.json so that it can be overwritten each time, but the path to the folder to hold it is passed in (we have been using the security_related folder that is ignored in the gitignore file so local cookie info wont be checked into version control)
   * If the cookie folder or file do not exist, just moves on with an error logged to the console - this can happen when the program is first run without cookies being recorded yet (will happen after the first time the user logs in)
   * This function is to simply try to launch a browser with cookies preloaded, so that it can be used
   *
   * @param {string}    dirToStoreCookies The path of the folder to use to store the cookies.json file this function creates - the folder is passed in and handled outside of this function although the plan is for it to be a folder that is listed in the gitignore file so that the cookies wont be checked into version control - for example a "security_related" folder that is only used locally - decided to pass this in as the same path would be used in the function to retrieve the cookies as well, so not great to duplicate that code multiple places
   * @param {Object}    puppeteerLaunchOptions The options object used for launching puppeteer, in this case the expected option would be {headless: false} or maybe {headless: true} - when this function is called to launch the initial browser uses for SSO logins, we will want it to always be visible/headless=false, but other times we may want to launch it with headless=true for the second browser doing the automation steps
   * @return {Object}   browser    A puppeteer browser object, in this case one that has been launched with the cookies from the prior browser session already having been loaded in from disk
   */
  async function launchBrowserWithSSOCookies(dirToStoreCookies, puppeteerLaunchOptions) {
    const browser = await puppeteer.launch(puppeteerLaunchOptions); 
    const pageTab1 = (await browser.pages())[0];    
    try {
      const cookies = fs.readFileSync(`${dirToStoreCookies}/cookies.json`, 'utf8');
      const deserializedCookies = JSON.parse(cookies);
      await pageTab1.setCookie(...deserializedCookies);      
    } catch (e) {
      console.error(`issue opening ${dirToStoreCookies}/cookies.json (may be because the program has never been run before) - exception thrown was: ${e}`);
    }
    return browser;
  }


  /**
   * Creates a screenshot directory inside the config directory that was passed into the function. 
   * 
   * When naming the screenshot directory, uses the format "<jsonconfigfilename without .json>_screenshots" The new screenshots subdirectory will be used to hold screenshots made during the automation.
   * Because there could be multiple json files, lets say with 100 KR records to update/automate listed in each config file, we want different screenshot subfolders per config file. That way if the first 
   * config file is named "group1.json" and second called "group2.json" we would have two folders, group1_screenshots and group2_screenshots, each containing 100 screenshots. This will help us keep things
   * better organized. 
   * 
   * @param {string}   jsonconfigfileArgumentPassedInFromCommandLine    The full raw jsonconfigfile argument passed into the program on the command line that points to the json config file to use.
   * 
   * @returns {string}    Returns the path to the screenshot subdirectory inside the config folder passed in, whether it needed to be created or not (already existed)
   */
  function createDirectoryToHoldScreenshots(jsonconfigfileArgumentPassedInFromCommandLine) {
    const configFileNameWithoutJsonExtension = path.basename(jsonconfigfileArgumentPassedInFromCommandLine, '.json');
    const screenshotsFolderName = `${configFileNameWithoutJsonExtension}_screenshots`;
    const jsonConfigFileDirPathOnly = path.dirname(jsonconfigfileArgumentPassedInFromCommandLine);
    const jsonConfigFileDirPathWithScreenshotSubfolder = path.join(jsonConfigFileDirPathOnly, screenshotsFolderName);
    return createDirIfDoesntExistAndGetPath(jsonConfigFileDirPathWithScreenshotSubfolder);
  }

  /**
   * Utility function for creating a directory at the path specified if it doesn't already exist.
   * 
   * adapted from: https://nodejs.dev/learn/working-with-folders-in-nodejs
   * @param {string}   pathOfDirToCreate    The file path and folder name to try to create, including slashes (node seems to take slashes in this format (/Users/joe/test).
   * 
   * @returns {string}    Returns the path to the directory, whether it needed to be created or not (already existed)
   */
  function createDirIfDoesntExistAndGetPath(pathOfDirToCreate) {
    try {
      if (!fs.existsSync(pathOfDirToCreate)) {
        fs.mkdirSync(pathOfDirToCreate)
      }
      return pathOfDirToCreate;
    } catch (err) {
      console.error(err)
    }
  }


  /**
   * Automate the cancelling of a list of KR prop dev proposals. 
   * 
   * Using a for loop because unfortunately map and foreach which can be used to write function programming syle code are not asyncronous and adding await inside the loop was causing it to try to parallel run everything inside cancel functions (trying to click the first link for all the proposals at once, which doesnt work if you are doing everything in the same browser tab)
   *  
   *  
   * @param {Object}   browser    The main Puppeteer browser object, will be needed to inspect the current list of iframes and potentially open new tabs
   * @param {string}   leftPortionOfKRDirectLinkToModule    The left portion of the direct link to a KR prop dev proposal, minus the proposal number portion, as would be generated from the link pop up at the top of KR prop dev module screen
   * @param {number[]} recordNumsToUpdateInKRArr    An array of the Prop Dev numbers that are used in KR as the rightmost portion of the direct link generated by the link feature of the Prop Dev module to generate a direct link/URL to pull up a specific Prop Dev record
   * @param {boolean}  krUsingNewDashboardWithIframes   Flag that indicates whether the KR dashboard is curently enabled
   * @param {string}   pathOfScreenshotDir    The path of the folder to add screenshots as the proposals are being closed to better see what happened.  
   * 
   */
  async function doAutomationCancelListPropDevProposals(browser, leftPortionOfKRDirectLinkToModule, recordNumsToUpdateInKRArr, isKrUsingNewDashboardWithIframes, pathOfScreenshotDir) {
    for (let i = 0; i < recordNumsToUpdateInKRArr.length; i++) {
      await tryCancellingSinglePropDevProposalCaptureScreenshotOnException(browser, leftPortionOfKRDirectLinkToModule, recordNumsToUpdateInKRArr[i], isKrUsingNewDashboardWithIframes, pathOfScreenshotDir);
    }
  }

  /**
   * Adds in a try catch block around the function to cancel a prop dev proposal and on any kind of exeption, takes a screenshot of the current tab
   *  
   * The main reason we needed to split this out into it's own function is that the await call seemed to only work correctly when this
   * was it's own function. This way we can preface each call with await and each individual one would have it's own catch block...so if there
   * are 5 in a list of 100 that failed, we would take screenshots of each one with an exception. Also without this broken out into a separate
   * function with await, the program was trying to do everything in parallel with it doing the first click step for all N number of proposals at the same time 
   * which obviously doesn't work when you only have a single browser tab
   * @param {Object}   browser    The main Puppeteer browser object, will be needed to inspect the current list of iframes and potentially open new tabs
   * @param {string}   leftPortionOfKRDirectLinkToModule    The left portion of the direct link to a KR prop dev proposal, minus the proposal number portion, as would be generated from the link pop up at the top of KR prop dev module screen
   * @param {number}   krRecordNumberToUpdate   The current KR record number (Prop Dev number, award number, etc) we are currently updating/automating    
   * @param {boolean}  krUsingNewDashboardWithIframes   Flag that indicates whether the KR dashboard is curently enabled
   * @param {string}   pathOfScreenshotDir    The path of the folder to add screenshots as the proposals are being closed to better see what happened.  
   * 
   */
async function tryCancellingSinglePropDevProposalCaptureScreenshotOnException(browser, leftPortionOfKRDirectLinkToModule, krRecordNumberToUpdate, isKrUsingNewDashboardWithIframes, pathOfScreenshotDir) {
  const currPropDevDirectLink = leftPortionOfKRDirectLinkToModule + krRecordNumberToUpdate;
  try {
    await automateCancellingSinglePropDevProposal(browser, currPropDevDirectLink, isKrUsingNewDashboardWithIframes, pathOfScreenshotDir);
  } catch (e) {
    // statements to handle any exceptions
    console.error(`automateCancellingSinglePropDevProposal with PD number: ${krRecordNumberToUpdate} failed with exception: ${(e.name + ': ' + e.message)}`);
    const pageTab1 = (await browser.pages())[0];
    takeScreenshot(pageTab1, `exceptionOnPD`, currPropDevDirectLink, pathOfScreenshotDir);      
  }  
}

  /**
   * Goes through the individual steps which taken together automate the cancelling of a single Prop Dev proposal (click sumary sbumit, cancel button, etc) and take a screenshot at the end to capture the final state.
   * 
   * @param {Object}   browser    The main Puppeteer browser object, will be needed to inspect the current list of iframes and potentially open new tabs
   * @param {string}   directLinkToProposal    The full direct link to a KR prop dev proposal, minus the proposal number portion, as would be generated from the link pop up at the top of KR prop dev module screen
   * @param {boolean}  krUsingNewDashboardWithIframes   Flag that indicates whether the KR dashboard is curently enabled
   * @param {string}   pathOfScreenshotDir    The path of the folder to add screenshots as the proposals are being closed to better see what happened.  
   * 
   * @return {boolean}    returns true if it makes it all the way through the steps - presumably an error would have been thrown already if not
   */
async function automateCancellingSinglePropDevProposal(browser, directLinkToProposal, krUsingNewDashboardWithIframes, pathOfScreenshotDir) {
  const pdDocIFrame = await getIframeAfterLoadingPropDev(krUsingNewDashboardWithIframes, browser, directLinkToProposal); // await openProposalInNewTabReturnPdFrame(browser, directLinkToProposal);

  await clickPropDevEditButton(pdDocIFrame);
  await clickPropDevMenuSummarySubmit(pdDocIFrame);
  await clickPropDevCancelProposalButton(pdDocIFrame);
  await clickPropDevOkCancelButtonOnPopup(pdDocIFrame);

  const pageTab1 = (await browser.pages())[0];
  await takeScreenshot(pageTab1, `afterCancelOk`, directLinkToProposal, pathOfScreenshotDir);
  console.log(`CSV: Finished cancelling Proposal: (${directLinkToProposal})`);

  return true; // cancelled the proposal
}

  /**
   * Take a screenshot of the current KR record and action - the screenshot filename will be based on the link and prefex string like "cancelStep" passed in and placed in the folder passed in.
   * 
   * Also changes the viewport size so that its verically very long so that the screenshot will capture everything (that was the only way I was getting a screenshot of the top error messages to be included).
   * The format of the screenshot filename includes both the URL of the direct link in KR to the record (so we can see if it is SBX, STG as well as the record number) - also added a string at the end that reflects what was happening when the screenshot was taken, as well as the current hr/min/month/day/year so that the screenshot is unique and doesnt get overwritten with subsequent runs or if you list the same record mulitiple times in order to do multiple reruns in case of a timeout on the initial runs 
   * 

   * @param {Object}   pageTabForScreenshot    The page object pointing to the current browser tab that is being clicked on/automated (that the screenshot will be taken of)
   * @param {string}   prefexFilenameWith    Text to include on the left hand side of the screenshot filename, so that if we want to take multiple screenshots per automation we can differentiate the different ones all done on the same KR record
   * @param {string}   linkToUseForFileName    The direct link to a KR record - used for generating the filename for each individual screenshot
   * @param {string}   pathOfScreenshotDir    The path of the folder to add screenshots as the proposals are being closed to better see what happened.  
   * 
   */
async function takeScreenshot(pageTabForScreenshot, prefexFilenameWith, linkToUseForFileName, pathOfScreenshotDir) {
  const linkUrlConvertedToFileNameFriendlyFormat = linkToUseForFileName.replace(/[^a-zA-Z0-9]/g,`_`);
  const currentDatetime = new Date();
  const pathFileNameAndExtension = path.format({
    dir: pathOfScreenshotDir,
    name: `${linkUrlConvertedToFileNameFriendlyFormat}__${prefexFilenameWith}_${currentDatetime.getHours()}_${currentDatetime.getMinutes()}_${currentDatetime.getDay()}_${currentDatetime.getMonth()}_${currentDatetime.getFullYear()}`,
    ext: `.jpg`
  });
  await pageTabForScreenshot.setViewport({
    width: 800,
    height: 1000
  });
  pageTabForScreenshot.screenshot({ path: pathFileNameAndExtension, type: `jpeg`, quality: jpegQualityOutOfHundred, fullpage: true });
}

  /**
   * Launches a browser with the KR home page, giving the user time to log in and pops up confirm to start automation
   *
   * This function does the initial steps to get a user logged in and ready to start
   * the automated data entry. It follows the following steps:
   * 1. launches a new chromium browser using puppeteer
   * 2. loads the KR dashboard/home page in the initial tab
   * @param {string}   KrDashboardUrl           The URL of the KR home page, used to trigger the approriate SSO login prompts
   * @param {number}   [howLongToWaitForSSOLogin=18000] The amount of time in milliseconds to wait for the user to get logged into KR with the SSO screens before popping up the question of whether they are ready to start the automations
   *
   * @return {Object} Return the top level puppeteer browser object now with the first tab logged into KR
   */
async function launchVisibleBrowserSSOLoginSaveCookies(KrDashboardUrl, howLongToWaitForSSOLogin=18000, dirToStoreCookies) {
  //const browserForSSOLogin = await puppeteer.launch();    //useful to see whats going on: slowMo: 250, in ,  args: ['--disable-features=site-per-process']
  const browserForSSOLogin = await launchBrowserWithSSOCookies(dirToStoreCookies, {headless: false})
  //setSSOCookiesFromPrevBrowser(pageTab1ForSSOLogin, dirToStoreCookies);
  const pageTab1ForSSOLogin = (await browserForSSOLogin.pages())[0];
  await Promise.all([
    pageTab1ForSSOLogin.goto(KrDashboardUrl),
    pageTab1ForSSOLogin.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  // if pageTab1ForSSOLogin url contains "idpselection" in the URL, assume we are NOT already logged in and close this initial visible browser just for SSO logins
  if (await pageTab1ForSSOLogin.url().includes(`${wordToLookForInURLToIdentifySSORedirect}`)) {
    console.info(`INFO: found we were redirected to the login page based on URL containing this keyword indicating we were redirected to an SSO screen: ${wordToLookForInURLToIdentifySSORedirect}`);
    // if pointed to the SSO login pages, assume we need to log in manually and run the function to wait 18 seconds 
    await giveUserTimeForSSOLogin(browserForSSOLogin, pageTab1ForSSOLogin, howLongToWaitForSSOLogin);
    await saveCopyOfCookiesEnvironmentVar(browserForSSOLogin, dirToStoreCookies);
    await browserForSSOLogin.close();
  } 
  else {
    console.info(`INFO: found that we were not redirected to an SSO page (url did not contain this keyword ${wordToLookForInURLToIdentifySSORedirect}) so assuming we do not need to prompt the user to log in manually, we will just use the cookies from the last browser session`);
    await browserForSSOLogin.close();
  }
}

  /**
   * Launches a browser with the KR home page, giving the user time to log in and pops up confirm to start automation
   *
   * This function does the initial steps to get a user logged in and ready to start
   * the automated data entry. It follows the following steps:
   * 
   * 3. given that the user will be presented with the SSO login which takes time, uses a timer to wait 10s of seconds until all the login MFA steps have been completed
   * 4. when the timer is up, pops up a new blank (second) tab with a js dialog box asking the user if they want to start the automation (OK/Cancel)
   * 5. if the user clicks ok, it closes the blank second tab, returning the browser object
   *    but if the user clicks cancel it closes the chromium browser and throws an error saying the person clicked cancel
   * @param {string}   KrDashboardUrl           The URL of the KR home page, used to trigger the approriate SSO login prompts
   * @param {number}   [howLongToWaitForSSOLogin=18000] The amount of time in milliseconds to wait for the user to get logged into KR with the SSO screens before popping up the question of whether they are ready to start the automations
   *
   * @return {Object} Return the top level puppeteer browser object now with the first tab logged into KR
   */
  async function giveUserTimeForSSOLogin(browserForSSOLogin, pageTab1ForSSOLogin, howLongToWaitForSSOLogin=18000) {  
    await pageTab1ForSSOLogin.waitForTimeout(howLongToWaitForSSOLogin)
    console.info(`INFO: Waited ${(howLongToWaitForSSOLogin/1000)} seconds! Popping up second (blank) tab with ok dialog`);
    const pageTab2ForSSOLogin = await browserForSSOLogin.newPage();
    const userConfirmedStartAutomation = await pageTab2ForSSOLogin.evaluate(_ => {
      return Promise.resolve(window.confirm(`Start automated data entry? (cancel=No)`));
    });
    if (!userConfirmedStartAutomation) {
      throw new Error(`The user clicked the cancel button when asked if they wanted to start the automation - shutting down the program with error return code`);
      process.exit(1); // terminate the program as the user has selected not to proceed with the automation
    }
  }

/**
 * Opens a proposal and determines the iframe that contains the actual kr document (proposal) that data entry needs to happen on.
 *
 * Because Kuali Research often has tons of nested iframes when the dashboard is
 * turned on and because Puppeteer needs to be passed the exact iframe that
 * contains the proposal etc that we are trying to do data entry on
 * and because for the old non-dashboard version there were no iframes, this
 * helper function figured out the whether to pass back the main frame or the
 * relevant child iframe that actually contains the KR document that has the
 * form elements/boxes that contain the proposal, etc info
 * Opens the proposal in the first browser tab and then returns either the parent frame
 * or the relevant child frame by lookiing for a particular portion of the URL of the 
 * child iframe URL that indicates its the iframe that contains the actual KR document 
 * with the form fields, etc to be clicked on, etc
 * @param {boolean}   krUsingNewDashboardWithIframes           Flag that indicates whether the KR dashboard is curently enabled
 * @param {Object} browser     The main Puppeteer browser object, will be needed to inspect the current list of iframes and potentially open new tabs
 * @param {string}   directLinkToProposal The URL of the KR record as would be generated from the link pop up at the top of KR proposal, award, etc records
 *
 * @return {Object} Returns the mainFrame or childFrame puppeteer object that points to the actual KR document which contains the form elements that will need to have the automated data entry done.
 */
async function getIframeAfterLoadingPropDev(krUsingNewDashboardWithIframes, browser, directLinkToProposal) {
  const pageTab1 = (await browser.pages())[0];
  await pageTab1.goto(directLinkToProposal);
  if (krUsingNewDashboardWithIframes) {
    return returnChildFrameWithUrlIncluding(pageTab1, `/kc-pd-krad/`)
  }
  else {
    return pageTab1.mainFrame();
  }
}

/**
 * Clicks on the Edit button at the bottom of the Prop Dev Details tab after making sure the edit button has loaded
 *
 * Set the timeout to 3 seconds so that for proposals that are no editable, we don't have to wait as long for the exception and screenshot and moving onto the next proposal (speed up moving through a big list of proposals)
 * @param {Object} propDevPageIframe     A puppeteer page object that points to iframe that contains the KR Proposal Development document with the form elements/buttons being updated/automated
 */
async function clickPropDevEditButton(propDevPageIframe) {
  console.info(`INFO: about to click on edit button, first step waiting for selector #u15ecnpy`);
  await propDevPageIframe.waitForSelector('#u15ecnpy');
  console.info(`INFO: selector #u15ecnpy appears to be loaded`);
  await Promise.all([
    propDevPageIframe.waitForNavigation(),
    propDevPageIframe.click('#u15ecnpy'),
  ]);
}

/**
 * Clicks on the Proposal Development "Summary/Submit" menu option on the righthand menu, after making sure the css for that menu option has loaded
 *
 * @param {Object} propDevPageIframe     A puppeteer page object that points to iframe that contains the KR Proposal Development document with the form elements/buttons being updated/automated
 */
async function clickPropDevMenuSummarySubmit(propDevPageIframe) {
  console.log(`INFO: about to click on summary/submit`);
  await propDevPageIframe.waitForSelector('#u79genf');
  await Promise.all([
    propDevPageIframe.waitForNavigation(),
    propDevPageIframe.click('#u79genf'),
  ]);
}

/**
 * Clicks the "Cancel Proposal" button at the bottom of the KR PD Summary/Submit tab after confirming the selector is loaded/present
 *
 * In the process of trying to get the click for this working, seemingly because it pops up modal window, found that I needed to use the $eval formatinstead of just a regular .click() for some reason
 * 
 * @param {Object} propDevPageIframe     A puppeteer page object that points to iframe that contains the KR Proposal Development document with the form elements/buttons being updated/automated
 */
async function clickPropDevCancelProposalButton(propDevPageIframe) {
  console.info(`INFO: about to click Cancel Proposal button at bottom of Summary/Submit tab (using $eval)`);
  await propDevPageIframe.waitForSelector('#u9v3fcv', { visible: true });
  await propDevPageIframe.$eval('#u9v3fcv', el => el.click());
}

/**
 * Clicks on the Ok button inside the "are you sure you want to cancel?" model that is popped up in KR when you click the Cancel Proposal on the PD Summary/Submit tab
 * 
 * Using the $eval seemed to work consistently for this to do the clicking (there might be some considerations given its inside a bootstrap model window) - also found that I needed to use the promise.all around it with a waitForNavigation() call or else when it tried to open the next proposal (next run of the doAutomatedDataEntryTasks function) it was showing a connection error navigating to the next proposal and it appears to be that it wasn't waiting until the page loaded after clicking the button, even though this one proposal would cancel
 * @param {Object} propDevPageIframe     A puppeteer page object that points to iframe that contains the KR Proposal Development document with the form elements/buttons being updated/automated
 */
async function clickPropDevOkCancelButtonOnPopup(propDevPageIframe) {
  console.info(`INFO: about to click ok button on the "are you sure you want to cancel?" model popup (using $eval)`);
  await propDevPageIframe.waitForSelector('#u15k794s', { visible: true });
  await Promise.all([
    propDevPageIframe.waitForNavigation(),
    propDevPageIframe.$eval('#u15k794s', el => el.click()),
  ]);    
}

/**
 * NOT YET WORKING - Confirm that the Prop Dev record was really cancelled by checking the status showing on the page/screen at the end
 * 
 * Using the $eval seemed to work consistently for this to do the clicking (there might be some considerations given its inside a bootstrap model window) - also found that I needed to use the promise.all around it with a waitForNavigation() call or else when it tried to open the next proposal (next run of the doAutomatedDataEntryTasks function) it was showing a connection error navigating to the next proposal and it appears to be that it wasn't waiting until the page loaded after clicking the button, even though this one proposal would cancel
 * @param {Object} propDevPageIframe     A puppeteer page object that points to iframe that contains the KR Proposal Development document with the form elements/buttons being updated/automated
 */
async function confirmPropDevReallyCancelled(propDevPageIframe) {
  console.info(`INFO: attempting to confirmPropDevReallyCancelled`);

  try {
    console.info(`INFO: inside try of confirmPropDevReallyCancelled, about to try to get proposalNameTextOnPage`);
    console.info(`INFO: about to do propDevPageIframe.waitForSelector('#PropDev-DefaultView_headerWrapper')`)
    await propDevPageIframe.waitForSelector('#PropDev-DefaultView_headerWrapper');
    console.info(`INFO: after propDevPageIframe.waitForSelector('#PropDev-DefaultView_headerWrapper'), about to try to get innerHTML `);
    const html = await propDevPageIframe.$eval('#PropDev-DefaultView_headerWrapper', e => e.innerHTML); 
    console.info(`INFO: #PropDev-DefaultView_headerWrapper innerHtml showing: ${html}`);
    const proposalNameTextOnPage = await propDevPageIframe.$eval('#u1p8pc9q', e => e.innerText); 
    console.info(`INFO: got proposalNameTextOnPage: ${proposalNameTextOnPage}`)
    const proposalNumberTextOnPage = await propDevPageIframe.$eval('#PropDev-DefaultView_header > span.uif-headerText-span', e => e.innerText);
    console.info(`INFO: got proposalNumberTextOnPage: ${proposalNumberTextOnPage}`)
    const proposalStatusTextOnPage = await propDevPageIframe.$eval('#u1wvlcrs', e => e.innerText); 
    console.log(`CSV: ${proposalNameTextOnPage}|${proposalNumberTextOnPage}|Status:|${proposalStatusTextOnPage}`);
  } catch (e) {
    console.error(`ERROR: inside error block for confirmPropDevReallyCancelled`);
    console.error(`ERROR: inside confirmPropDevReallyCancelled checking for, exception is ${e.name}:${e.message} `);
  }

}

/**
 * Goes through the nested iframes used by KR with the dashboard and tries to pick out the iframe that actually contains the KR document (with form fields, etc) by matching on a portion of the URL of the iframe
 * 
 * It first waits for the outer iframe and inner iframes to fully load using the waituntil feature in Puppeteer
 * then loops through all the child frames looking for one where the URL has the URL fragment passed in that tends to be 
 * specific to a KR document's URL (PD may be different than award so the URL is a parameter to pass in)
 * 
 * Using the $eval seemed to work consistently for this to do the clicking (there might be some considerations given its inside a bootstrap model window) - also found that I needed to use the promise.all around it with a waitForNavigation() call or else when it tried to open the next proposal (next run of the doAutomatedDataEntryTasks function) it was showing a connection error navigating to the next proposal and it appears to be that it wasn't waiting until the page loaded after clicking the button, even though this one proposal would cancel
 * @param {Object} parentPageObj     A puppeteer page object that points to the parent iframe (that potentially has child iframes within that might be the actual KR document with form fields, etd).
 * @param {string} strUrlPortionToMatch   A string containing a portion of a url that would identify a frame that has a KR document inside (with form fields, etc) - different KR modules likely have slightly different URLs - for example the Iframe with the KR Prop Dev records alwasys seems to have `/kc-pd-krad/` as part of the URL
 */
async function returnChildFrameWithUrlIncluding(parentPageObj, strUrlPortionToMatch) {
  console.info(`INFO: inside returnChildFrameWithUrlIncluding(), matching on ${strUrlPortionToMatch}`);
  await parentPageObj.mainFrame().waitForNavigation({ waitUntil: 'networkidle0' });
  console.log(`INFO: after doing parentPageObj.mainFrame().waitForNavigation({ waitUntil: 'networkidle0' }), parentPageObj.mainFrame().childFrames().length is now: ${parentPageObj.mainFrame().childFrames().length}`);  
  for (const frame of parentPageObj.mainFrame().childFrames()){
    console.info(`INFO:initial frame.url() of the current child frame is: ${frame.url()}`);
    if (frame.url().includes(strUrlPortionToMatch)){
        console.log(`INFO: we found the iframe with url containing ${strUrlPortionToMatch} with name: ${frame.name()}`);
        return frame;
    }
 }
  throw new Error(
    `throwing error because did not detect any child frames matching: ${strUrlPortionToMatch}`
  )
};
