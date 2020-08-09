#-------------------------------------------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See https://go.microsoft.com/fwlink/?linkid=2090316 for license information.
#-------------------------------------------------------------------------------------------------------------

# To fully customize the contents of this image, use the following Dockerfile instead:
# https://github.com/microsoft/vscode-dev-containers/tree/v0.128.0/containers/typescript-node-14/.devcontainer/Dockerfile
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:0-14

RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    #
    # Common utilities necessary for file management, revision control
    #    
    && apt-get -qq -y install --no-install-recommends git curl wget zip \
    #
    # Common utilities necessary only for development and engineering
    #    
    && apt-get -qq -y install --no-install-recommends vim man miller \
    #
    # Shell and CLI tools for enhanced developer experience (not required for deployments, only engineering).
    # Note the use of "... | /bin/su - node" when setting up shell, 'node' should be same as '"remoteUser": "node"'
    # in the devcontainer.json configuration file.
    #
    && curl https://raw.githubusercontent.com/shah/engineering-sandbox-debian/master/setup-deb-zsh-zprezto.sh | /bin/su - node \
    && curl https://raw.githubusercontent.com/shah/engineering-sandbox-debian/master/p10k.zsh > /home/node/.p10k.zsh \
    && curl https://raw.githubusercontent.com/shah/engineering-sandbox-debian/master/zpreztorc > /home/node/.zprezto/runcoms/zpreztorc
