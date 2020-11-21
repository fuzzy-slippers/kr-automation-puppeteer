const puppeteer = require('puppeteer');

/*
const KrDashboardUrl = `https://greendale-sbx.kuali.co/res`;
const PropDev1 = `https://greendale-sbx.kuali.co:/res/kc-common/development-proposals/1177`;
const PropDev2 = `https://greendale-sbx.kuali.co:/res/kc-common/development-proposals/1187`;
const PropDev3 = `https://greendale-sbx.kuali.co:/res/kc-common/development-proposals/1186`;
*/






const krUsingNewDashboardWithIframes = false;
const KrDashboardUrl = `https://usmd-stg.kuali.co/res/`;
const PropDev1 = `https://usmd-stg.kuali.co:/res/kc-common/development-proposals/201024`;
const PropDev2 = `https://usmd-stg.kuali.co/res/kc-common/development-proposals/200836`;
const PropDev3 = `https://usmd-stg.kuali.co:/res/kc-common/development-proposals/201020`;



(async () => {
// group: set up initial browser/tabs
  const browser = await puppeteer.launch({headless: false,  args: ['--disable-features=site-per-process']}); //useful to see whats going on: slowMo: 250,
  //open kr to main page/dashboard which will prompt to get logged into KR, including UMD SSO, etc and get everything ready for puppeteer to start
  const initialTabForBrowser = (await browser.pages())[0];
  await initialTabForBrowser.goto(KrDashboardUrl);
// end group: set up initial broswer/tabs

// group: set timer to wait for login, then pop up "Start automated data entry? popup"
  // wait for a certain fixed amount of time for the person to get all logged into KR
  await initialTabForBrowser.waitForTimeout(18000)
  console.log('Waited eighteen seconds!');
  //once the person has had time to get logged in


  //more reliable to use a second (blank) tab to pop up the alert to start the automation
  const pageTab1 = await browser.newPage();
  await pageTab1.goto(KrDashboardUrl);



  // when times up pop up dialog to confirm ready to start the automated data entry - evaluate will run the function in the page context (the opened page)
  const confirmedStartAutomation = await pageTab1.evaluate(_ => {
    return Promise.resolve(window.confirm(`Start automated data entry? (cancel=No)`));
  });
// end group: set timer to wait for login, then pop up "Start automated data entry? popup"

  // if the person clicks "ok" to start the automation - start filling things out with puppeteer
  if (confirmedStartAutomation) {
    //TODO: ADD SCREENSHOTS INTO BELOW FUNCTION
    // now do the automated changes to the proposals (later may want to use a json array or something external)
    await doAutomatedDataEntryTasks(browser, PropDev1);
    await doAutomatedDataEntryTasks(browser, PropDev2);
    await doAutomatedDataEntryTasks(browser, PropDev3);
  }
  // if the person clicks the cancel button - close the browser and do not start automation
  else {
    await browser.close();
  }


})();


async function doAutomatedDataEntryTasks(browser, directLinkToProposal) {

  // use function to keep trying until we get a tab open that has the iframe present that we need to update the proposal - using a function for this
  const pdDocChildFrame = await openProposalInNewTabReturnPdFrame(browser, directLinkToProposal);


  //fist click on edit button on the bottom (only can cancel proposals when in edit mode, not view mode) - first make sure the button is present, then click it
  console.log(`about to click on edit button`);
  await pdDocChildFrame.waitForSelector('#u15ecnpy');
  let element = await pdDocChildFrame.$('#u15ecnpy');
  console.log(`element for edit button: ${element}`);
  let value = await pdDocChildFrame.evaluate(el => el.textContent, element)
  console.log(`value for edit button: ${value}`);
  await Promise.all([
    pdDocChildFrame.waitForNavigation(),
    pdDocChildFrame.click('#u15ecnpy'),
  ]);

  //next click on Summary/Submit menu option on left side of iframe
  console.log(`about to click on summary/submit`);
  await pdDocChildFrame.waitForSelector('#u79genf');
  await Promise.all([
    pdDocChildFrame.waitForNavigation(),
    pdDocChildFrame.click('#u79genf'),
  ]);


  //next click the cancel button at the bottom of the iframe - because it pops up modal window, found that I needed to use the $eval format below instead of just a regular .click() for some reason
  console.log(`about to click cancel button (using $eval)`);
  await pdDocChildFrame.waitForSelector('#u9v3fcv', { visible: true });
  await pdDocChildFrame.$eval('#u9v3fcv', el => el.click());


  // console.log(`about to click ok button on the "are you sure you want to cancel?" model popup`);
  // await pdDocChildFrame.waitForSelector('#u15k794s', { visible: true });
  // console.log(`trying eval click..`);
  // await pdDocChildFrame.$eval('#u15k794s', el => el.click());

/* not needed
  // console.log(`trying promise.all click()`);
  // await Promise.all([
  //   pdDocChildFrame.waitForNavigation(),
  //   pdDocChildFrame.click('#u15k794s'),
  // ]);
*/

  console.log(`cancelled the proposal (${directLinkToProposal}) so returning true`);
  return true; // cancelled the proposal
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
