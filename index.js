const core = require("@actions/core");
const github = require("@actions/github");

try {
  const waitInterval = parseInt(
    core.getInput("wait-interval-seconds", { required: true })
  );
  const waitMax = parseInt(core.getInput("wait-max-seconds", { required: true }));
  const token = core.getInput("repo-token", { required: true });
  let workflows = core
    .getInput("workflows", { required: true })
    .split("\n")
    .map((x) => x.trim());

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const checkIfWorkflowDone = async function (workflowName) {
    let conclusion, run_id, waiting_created_at;
    try {
      console.log({
        owner,
        repo,
        workflow_id: workflowName,
        event: github.context.eventName,
        branch: github.context.ref.split('refs/heads/')[1],
        per_page: 1,
      })
      const { data } = await octokit.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflowName,
        event: github.context.eventName,
        branch: github.context.ref.split('refs/heads/')[1],
        per_page: 5,
      });
      const filteredForSha = data.workflow_runs.filter(x => x.head_sha === github.context.sha)
      if (filteredForSha.length < 1) return false;
      const mostRecent = filteredForSha[0];
      console.log(JSON.stringify(github.context, null, 4));
      if (mostRecent.status !== 'completed') return false;
      conclusion = mostRecent.conclusion;
      run_id = mostRecent.run_id;
      waiting_created_at = data.created_at;
    } catch (e) {
      core.info(e);
      return false;
    }
    if (conclusion !== 'success') throw new Error(`Workflow ${workflowName} failed`);
    const { data: { created_at } } = await octokit.actions.getWorkflowRun({
      owner, repo, run_id
    });
    const startDiff = new Date(created_at).getTime() - new Date(waiting_created_at).getTime();
    if (startDiff > 5000) {
      // If it was created more than 5 seconds before this workflow we assume it was in relation to something else
      return false;
    }
    return true;
  };

  const sleep = async function (seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  };

  (async () => {
    try {
      let executedTime = 0;
      let workflowsStillNotDone = [...workflows];
      while (workflowsStillNotDone.length > 0) {
        workflows = [...workflowsStillNotDone];
        for (workflow of workflows) {
          const done = await checkIfWorkflowDone(workflow);
          if (done == false) break;
          core.info(`Workflow ${workflow} is done after ${executedTime} seconds`);
          // It is done so we don't need to keep checking it
          workflowsStillNotDone = workflowsStillNotDone.filter(x => x !== workflow);
        }
        if (workflowsStillNotDone.length === 0) break;
        await sleep(waitInterval);
        executedTime += waitInterval;
        if (executedTime > waitMax) {
          core.setFailed("Time exceeded the maximum " + waitMax + " seconds");
          break;
        }
      }
    } catch (error) {
      core.setFailed(error.message);
    }
  })();
} catch (error) {
  core.setFailed(error.message);
}
