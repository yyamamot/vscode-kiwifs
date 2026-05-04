import * as path from "node:path";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
    color: true
  });

  mocha.addFile(
    path.resolve(
      __dirname,
      process.env.KIWIFS_HOST_SUITE_MODE === "ui-review"
        ? "./uiReview.spec.js"
        : "./extension.spec.js"
    )
  );

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration-host tests failed.`));
        return;
      }
      resolve();
    });
  });
}
