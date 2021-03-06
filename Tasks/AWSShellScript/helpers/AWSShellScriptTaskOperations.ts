/*
  Copyright 2017-2018 Amazon.com, Inc. and its affiliates. All Rights Reserved.
  *
  * Licensed under the MIT License. See the LICENSE accompanying this file
  * for the specific language governing permissions and limitations under
  * the License.
  */

import tl = require('vsts-task-lib/task');
import tr = require('vsts-task-lib/toolrunner');
import fs = require('fs');
import path = require('path');
import { SdkUtils } from 'sdkutils/sdkutils';
import { TaskParameters } from './AWSShellScriptTaskParameters';

export class TaskOperations {

    public constructor(
        public readonly taskParameters: TaskParameters
    ) {
    }

    // based on the VSTS 'ShellScript' task but modified to inject AWS credentials
    // and region into the environment, and to be able to specify the script inline
    // or from a file
    public async execute(): Promise<number> {

        let scriptPath: string;
        try {
            await this.configureAWSContext();
            await this.taskParameters.configureHttpProxyFromAgentProxyConfiguration('AWSShellScript');

            const bash = tl.tool(tl.which('bash', true));

            if (this.taskParameters.scriptType === TaskParameters.inlineScriptType) {
                const tempDir = SdkUtils.getTempLocation();
                const fileName = 'awsshellscript_' + process.pid + '.sh';
                scriptPath = path.join(tempDir, fileName);
                tl.writeFile(scriptPath, this.taskParameters.inlineScript);
            } else {
                scriptPath = this.taskParameters.filePath;
            }

            let cwd = this.taskParameters.cwd;
            if (!cwd && !this.taskParameters.disableAutoCwd) {
                cwd = path.dirname(scriptPath);
            }

            tl.mkdirP(cwd);
            tl.cd(cwd);

            bash.arg(scriptPath);

            if (this.taskParameters.arguments) {
                bash.line(this.taskParameters.arguments);
            }

            const execOptions = <tr.IExecOptions>{
                env: process.env,
                failOnStdErr: this.taskParameters.failOnStandardError
            };

            return await bash.exec(execOptions);
        } finally {
            if (this.taskParameters.scriptType === TaskParameters.inlineScriptType
                && scriptPath
                && tl.exist(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }
        }
    }

    // If assume role credentials are in play, make sure the initial generation
    // of temporary credentials has been performed. If no credentials and/or
    // region were defined then we assume they are already set in the host
    // environment. Environment variables are preferred over stored profiles
    // as this isolates parallel builds and avoids content left lying around on
    // the agent when a build completes
    private async configureAWSContext() {
        const env = process.env;

        const credentials = await this.taskParameters.getCredentials();
        if (credentials) {
            await credentials.getPromise();
            tl.debug('configure credentials into environment variables');
            env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
            env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
            if (credentials.sessionToken) {
                env.AWS_SESSION_TOKEN = credentials.sessionToken;
            }
        }

        const region = await this.taskParameters.getRegion();
        if (region) {
            tl.debug('configure region into environment variable');
            env.AWS_REGION = region;
            // set for the benefit of any aws cli commands the user might
            // exec as part of the script
            env.AWS_DEFAULT_REGION = region;
        }
    }
}
