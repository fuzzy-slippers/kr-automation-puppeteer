const puppeteer = require('puppeteer');

/*
const KrDashboardUrl = `https://greendale-sbx.kuali.co/res`;
const PropDev1 = `https://greendale-sbx.kuali.co:/res/kc-common/development-proposals/1177`;
const PropDev2 = `https://greendale-sbx.kuali.co:/res/kc-common/development-proposals/1187`;
const PropDev3 = `https://greendale-sbx.kuali.co:/res/kc-common/development-proposals/1186`;
*/






const krUsingNewDashboardWithIframes = false;
const howLongToWaitForSSOLogin = 18000;
const KrDashboardUrl = `https://usmd-stg.kuali.co/res/`;
const PropDev1 = `https://usmd-stg.kuali.co:/res/kc-common/development-proposals/34927`;
const PropDev2 = `https://usmd-stg.kuali.co/res/kc-common/development-proposals/200836`;
const PropDev3 = `https://usmd-stg.kuali.co:/res/kc-common/development-proposals/201020`;



(async () => {

  const browser = await launchBrowserGiveUserTimeForSSOLogin(KrDashboardUrl, howLongToWaitForSSOLogin);

  await doAutomatedDataEntryTasks(browser, PropDev1, krUsingNewDashboardWithIframes);
  await doAutomatedDataEntryTasks(browser, PropDev2, krUsingNewDashboardWithIframes);
  await doAutomatedDataEntryTasks(browser, PropDev3, krUsingNewDashboardWithIframes);

})();


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
  console.log(`INFO: Waited ${(howLongToWaitForSSOLogin/1000)} seconds! Popping up second (blank) tab with ok dialog`);
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

async function doAutomatedDataEntryTasks(browser, directLinkToProposal, krUsingNewDashboardWithIframes) {
  // (old comment only applicable for when KR dashboard turned on) - use function to keep trying until we get a tab open that has the iframe present that we need to update the proposal - using a function for this
  const pdDocChildFrame = await getIframeAfterLoadingPropDev(krUsingNewDashboardWithIframes, browser, directLinkToProposal); // await openProposalInNewTabReturnPdFrame(browser, directLinkToProposal);

  await clickPropDevEditButton(pdDocChildFrame);
  await clickPropDevMenuSummarySubmit(pdDocChildFrame);
  await clickPropDevCancelProposalButton(pdDocChildFrame);
  await clickPropDevOkCancelButtonOnPopup(pdDocChildFrame);

  console.log(`CSV: Finished cancelling Proposal: (${directLinkToProposal})`);
  return true; // cancelled the proposal
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
  console.log(`INFO: about to click on edit button, first step waiting for selector #u15ecnpy`);
  await propDevPageIframe.waitForSelector('#u15ecnpy');
  console.log(`INFO: selector #u15ecnpy appears to be loaded`);
  //let element = await propDevPageIframe.$('#u15ecnpy');
  //console.log(`INFO: element for edit button: ${element}`);
  //let value = await propDevPageIframe.evaluate(el => el.textContent, element)
  //console.log(`INFO: value for edit button: ${value}`);
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
  console.log(`INFO: about to click Cancel Proposal button at bottom of Summary/Submit tab (using $eval)`);
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
  console.log(`INFO: about to click ok button on the "are you sure you want to cancel?" model popup (using $eval)`);
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
    console.log(`inside try ${tryNumber} of returnChildFrameWithUrlIncluding `);
    //add new browser tab (we have been calling pageTab) to the array
    const tempNewBrowserTab = await browser.newPage();
    browserTabArr.push(tempNewBrowserTab);
    //open prop dev proposal in new pageTab
    await browserTabArr[tryNumber].goto(directLinkToProposal);
    //make sure page is fully loaded before looking at child frames
    const pdDocChildFrame = await returnChildFrameWithUrlIncluding(browserTabArr[tryNumber], `/kc-pd-krad/`);
    console.log(`pdDocChildFrame.url() is: ${pdDocChildFrame.url()}`);
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
  console.log(`inside returnChildFrameWithUrlIncluding(), matching on ${strUrlPortionToMatch}`);
  console.log(`NOT WORKING waiting for selector #PropDev-DocumentFooter`);
  await parentPageObj.waitForSelector('#PropDev-DocumentFooter');
  console.log(`after wait for selector #PropDev-DocumentFooter`);

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
