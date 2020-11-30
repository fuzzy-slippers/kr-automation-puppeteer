#!/usr/bin/env node
const puppeteer = require(`puppeteer`);
const fs = require(`fs`);
const path = require(`path`).posix;

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
    const browser = await launchBrowserGiveUserTimeForSSOLogin(argv.urlToTriggerSSOLogin, argv.howLongToWaitForSSOLogin);

    switch (argv.automationTask) {
      case `cancelPropDevProposals`:
        await doAutomationCancelListPropDevProposals(browser, argv.leftPortionOfKRDirectLinkToModule, argv.recordNumsToUpdateInKRArr, argv.isKrUsingNewDashboardWithIframes, pathOfScreenshotDirInsideConfigFolder);
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

  // /**
  //  * Utility to strip out just the path portion (directory path) of the jsconfig file command line argument passed into the program
  //  * 
  //  * @param {string}   jsconfigfileFromArgv    The full jsconfigfile argument passed into the program (going into argv)
  //  * 
  //  * @returns {string}    The path portion of the jsconfigfile minus the json filename portion so ./path/to/file/ but not the "sampleConfig.json"
  //  */
  // function getPathOnlyForJsconfigfile(jsconfigfileFromArgv) {
  //   return path.dirname(jsconfigfileFromArgv);
  // }

  /**
   * Automate the cancelling of a list of KR prop dev proposals. 
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

    const PropDev1 = leftPortionOfKRDirectLinkToModule + recordNumsToUpdateInKRArr[0];
    const PropDev2 = leftPortionOfKRDirectLinkToModule + recordNumsToUpdateInKRArr[1];
    const PropDev3 = leftPortionOfKRDirectLinkToModule + recordNumsToUpdateInKRArr[2];

    await automateCancellingSinglePropDevProposal(browser, PropDev1, isKrUsingNewDashboardWithIframes, pathOfScreenshotDir);
    await automateCancellingSinglePropDevProposal(browser, PropDev2, isKrUsingNewDashboardWithIframes, pathOfScreenshotDir);
    await automateCancellingSinglePropDevProposal(browser, PropDev3, isKrUsingNewDashboardWithIframes, pathOfScreenshotDir);
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
  takeScreenshot(pageTab1, `afterCancelOk`, directLinkToProposal, pathOfScreenshotDir);
  console.log(`CSV: Finished cancelling Proposal: (${directLinkToProposal})`);
  return true; // cancelled the proposal
}

  /**
   * Take a screenshot of the current KR record and action - the screenshot filename will be based on the link and prefex string like "cancelStep" passed in and placed in the folder passed in.
   * 
   * @param {Object}   pageTabForScreenshot    The page object pointing to the current browser tab that is being clicked on/automated (that the screenshot will be taken of)
   * @param {string}   prefexFilenameWith    Text to include on the left hand side of the screenshot filename, so that if we want to take multiple screenshots per automation we can differentiate the different ones all done on the same KR record
   * @param {string}   linkToUseForFileName    The direct link to a KR record - used for generating the filename for each individual screenshot
   * @param {string}   pathOfScreenshotDir    The path of the folder to add screenshots as the proposals are being closed to better see what happened.  
   * 
   */
function takeScreenshot(pageTabForScreenshot, prefexFilenameWith, linkToUseForFileName, pathOfScreenshotDir) {
  const linkUrlConvertedToFileNameFriendlyFormat = linkToUseForFileName.replace(/[^a-zA-Z0-9]/g,`_`);
  const pathFileNameAndExtension = path.format({
    dir: pathOfScreenshotDir,
    name: `${prefexFilenameWith}_${linkUrlConvertedToFileNameFriendlyFormat}`,
    ext: `.jpg`
  });
  pageTabForScreenshot.screenshot({ path: pathFileNameAndExtension, type: `jpeg`, quality: 35, fullpage: true });
}

  /**
   * Launches a browser with the KR home page, giving the user time to log in and pops up confirm to start automation
   *
   * This function does the initial steps to get a user logged in and ready to start
   * the automated data entry. It follows the following steps:
   * 1. launches a new chromium browser using puppeteer
   * 2. loads the KR dashboard/home page in the initial tab
   * 3. given that the user will be presented with the SSO login which takes time, uses a timer to wait 10s of seconds until all the login MFA steps have been completed
   * 4. when the timer is up, pops up a new blank (second) tab with a js dialog box asking the user if they want to start the automation (OK/Cancel)
   * 5. if the user clicks ok, it closes the blank second tab, returning the browser object
   *    but if the user clicks cancel it closes the chromium browser and throws an error saying the person clicked cancel
   * @param {string}   KrDashboardUrl           The URL of the KR home page, used to trigger the approriate SSO login prompts
   * @param {number}   [howLongToWaitForSSOLogin=18000] The amount of time in milliseconds to wait for the user to get logged into KR with the SSO screens before popping up the question of whether they are ready to start the automations
   *
   * @return {Object} Return the top level puppeteer browser object now with the first tab logged into KR
   */
async function launchBrowserGiveUserTimeForSSOLogin(KrDashboardUrl, howLongToWaitForSSOLogin=18000) {
  const browser = await puppeteer.launch({headless: false,  args: ['--disable-features=site-per-process']}); //useful to see whats going on: slowMo: 250,
  const pageTab1 = (await browser.pages())[0];
  await pageTab1.goto(KrDashboardUrl);
  await pageTab1.waitForTimeout(howLongToWaitForSSOLogin)
  console.info(`INFO: Waited ${(howLongToWaitForSSOLogin/1000)} seconds! Popping up second (blank) tab with ok dialog`);
  const pageTab2 = await browser.newPage();
  const userConfirmedStartAutomation = await pageTab2.evaluate(_ => {
    return Promise.resolve(window.confirm(`Start automated data entry? (cancel=No)`));
  });
  if (userConfirmedStartAutomation) {
    pageTab2.close();
    return browser;
  }
  else {
    await browser.close();
    throw new Error(`The user clicked the cancel button when asked if they wanted to start the automation - shutting down the program with error return code`);
  }
}



/**
 * Opens a proposal and determines the iframe that contains the actual kr document (proposal) that data entry needs to happen on.
 *
 * Because Kuali Research often has tons of nested iframes when the dashboard is
 * turned on and because Puppeteer needs to be passed the exact iframe that
 * contains the the proposal etc that we are trying to do data entry on
 * and because for the old non-dashboard version there were no iframes, this
 * helper function figured out the whether to pass back the main frame or the
 * relevant child iframe that actually contains the KR document that has the
 * form elements/boxes that contain the proposal, etc info
 *
 *
 *
 * @param {boolean}   krUsingNewDashboardWithIframes           Flag that indicates whether the KR dashboard is curently enabled
 * @param {Object} browser     The main Puppeteer browser object, will be needed to inspect the current list of iframes and potentially open new tabs
 * @param {string}   directLinkToProposal The URL of the KR record as would be generated from the link pop up at the top of KR proposal, award, etc records
 *
 * @return {Object} Returns the mainFrame or childFrame puppeteer object that points to the actual KR document which contains the form elements that will need to have the automated data entry done.
 */
async function getIframeAfterLoadingPropDev(krUsingNewDashboardWithIframes, browser, directLinkToProposal) {
  if (krUsingNewDashboardWithIframes) {
    return openProposalInNewTabReturnPdFrame(browser, directLinkToProposal);
  }
  else {
    // for KR with the dashboard turned off - open the proposal in the first browser tab and then return the parent frame
    const pageTab1 = (await browser.pages())[0];
    await pageTab1.goto(directLinkToProposal);
    return pageTab1.mainFrame();
  }
}

/**
 * Clicks on the Edit button at the bottom of the Prop Dev Details tab after making sure the edit button has loaded
 *
 * @param {Object} propDevPageIframe     A puppeteer page object that points to iframe that contains the KR Proposal Development document with the form elements/buttons being updated/automated
 */
async function clickPropDevEditButton(propDevPageIframe) {
  console.info(`INFO: about to click on edit button, first step waiting for selector #u15ecnpy`);
  await propDevPageIframe.waitForSelector('#u15ecnpy');
  console.info(`INFO: selector #u15ecnpy appears to be loaded`);
  //let element = await propDevPageIframe.$('#u15ecnpy');
  //console.info(`INFO: element for edit button: ${element}`);
  //let value = await propDevPageIframe.evaluate(el => el.textContent, element)
  //console.info(`INFO: value for edit button: ${value}`);
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

//---------------------ONLY USEFUL FOR WHEN KR DASHBOARD USING IFRAMES IS TURNED ON-------------------//

async function openProposalInNewTabReturnPdFrame(browser, directLinkToProposal) {
  const browserTabs = [];

  //we follow the same steps for all the tries and retries
  let addBrowserTabReturnValidPdFrame = async function (tryNumber, browserTabArr) {
    console.info(`inside try ${tryNumber} of returnChildFrameWithUrlIncluding `);
    //add new browser tab (we have been calling pageTab) to the array
    const tempNewBrowserTab = await browser.newPage();
    browserTabArr.push(tempNewBrowserTab);
    //open prop dev proposal in new pageTab
    await browserTabArr[tryNumber].goto(directLinkToProposal);
    //make sure page is fully loaded before looking at child frames
    const pdDocChildFrame = await returnChildFrameWithUrlIncluding(browserTabArr[tryNumber], `/kc-pd-krad/`);
    console.info(`pdDocChildFrame.url() is: ${pdDocChildFrame.url()}`);
    return pdDocChildFrame;
  };

  // try this 5 times - unfortunately, sometimes does not load all the iframes so using try catch to try with multiple tabs if this happens until we get one that has the PD iframe need to click on things/update PD
  try {
    return await addBrowserTabReturnValidPdFrame(0,browserTabs);
  } catch {
    try {
      return await addBrowserTabReturnValidPdFrame(1,browserTabs);
    } catch {
      try {
        return await addBrowserTabReturnValidPdFrame(2,browserTabs);
      } catch {
        try {
          return await addBrowserTabReturnValidPdFrame(3,browserTabs);
        } catch {
          try {
            return await addBrowserTabReturnValidPdFrame(4,browserTabs);
          } catch {
            console.log(`in catch block of 5th try (tryNumber index 4) of addBrowserTabReturnValidPdFrame`);
          }
        }
      }
    }
  }
}

async function returnChildFrameWithUrlIncluding(parentPageObj, strUrlPortionToMatch) {
  console.info(`inside returnChildFrameWithUrlIncluding(), matching on ${strUrlPortionToMatch}`);
  await parentPageObj.waitForSelector('#cz-panel-container');
  console.log(`after wait for selector #cz-panel-container`);

  console.log(`first just check if the mainFrame (non-child iframe) has ${strUrlPortionToMatch} in the URL`);
  console.log(`the old non-dashboard seems not to have iframes at all - if the main frame is the PD document return the single parent frame and dont even look at the children iframes, if they exist`);
  if (parentPageObj.mainFrame().url().includes(strUrlPortionToMatch)) {
    return parentPageObj.mainFrame();
  }
  else {
    console.log(`parentPageObj.mainFrame().url() is ${parentPageObj.mainFrame().url()}`)
    console.log(`parentPageObj.mainFrame().childFrames().length is: ${parentPageObj.mainFrame().childFrames().length}`)
    for (const frame of parentPageObj.mainFrame().childFrames()){
        console.log(`initial frame.url() of the current child frame is: ${frame.url()}`);
        //frame.waitForNavigation({ waitUntil: 'networkidle0' });
        console.log(`after waitForNavigation frame.url() of the current child frame is: ${frame.url()}`);
        // Here you can use few identifying methods like url(),name(),title()
        if (frame.url().includes(strUrlPortionToMatch)){
            console.log(`we found the iframe with url containing ${strUrlPortionToMatch} with name: ${frame.name()}`);
            return frame;
        }
    }
    throw new Error(
      `throwing error because did not detect any child frames matching: ${strUrlPortionToMatch}`
    );
  }
}
