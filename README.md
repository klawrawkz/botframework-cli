# BF Command Line Interface

As part of the effort to improve Bot Framework SDK toolset we are happy to announce the introduction of a new Command Line Interface tool which will eventually replace the suite of tools currently used during Bots development. The new CLI, called BF is being released as an early preview. We have migrated Chatdown as a first proof of concept plugin. The new Chatdown plugin is fully functional and identical to the standalone tool (with some minor usage bug fixes). Early adopters are welcome to switch to the new CLI. In the meantime the old and new tools will exist side by side for at least a full release cycle.

# Plugin Architecture
BF CLI is based on [OClif](https://github.com/oclif/oclif) Framework and inherits its command line parsing style, and plugin architecture. 

# Installation

BF is based on Node.JS platform. You must download the following __prerequisties__:

* [Node.JS](https://nodejs.org/) version 10.14.1 or higher

Install the tool using the following command: 

\[TBD\] ~~npm i -g @microsoft/botframework-cli~~

To view detailed usage information see the [CLI ReadMe page](https://github.com/microsoft/botframework-cli/tree/master/packages/cli)

# Issues and Feature Requests
Please file issues and feature requests [here](https://github.com/microsoft/botframework-cli/issues).

Thank you for your support.

# Available Commands
The following commands are currently available:
* [Chatdown](https://github.com/microsoft/botframework-cli/tree/master/packages/chatdown) 

# Privacy
Privacy is very important to us. BF CLI contains optional instrumentation that is designed to help us improve the tool based on **anonymous** usage patterns. __It is disabled, opted-out by default__. If you elect to opt-in, we will gather some usage data as follows:
* Command group calls
* Flags used **excluding** specific values (i.e. if used parameter _--folder:name_, we will only gather the use of _--folder_ but will not capture _name_).

At any time you may disable data collection by changing the configuration using command:
~~~ 
bf configure --data-collection No
~~~
To view your current settings type:
~~~ 
bf configure
~~~


Please refer to [Microsoft Privacy Statement](https://privacy.microsoft.com/en-US/privacystatement) for more details.  

# Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
