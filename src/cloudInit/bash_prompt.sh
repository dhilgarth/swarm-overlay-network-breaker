#!/bin/bash

project_name="${PROJECT_NAME}"
environment_name="${ENVIRONMENT_NAME}"

# Define prompt colors
prompt_color_red="\\[\\033[31m\\]"
prompt_color_bright_cyan="\\[\\033[36;1m\\]"
prompt_color_bright_green="\\[\\033[32;1m\\]"
prompt_color_light_blue="\\[\\033[94m\\]"
prompt_color_reset_all="\\[\\033[0m\\]"
prompt_color_reset_foreground="\\[\\033[39m\\]"

# Set the PS1 variable
PS1="${prompt_color_red}\\u${prompt_color_reset_foreground}@${prompt_color_bright_cyan}\\h${prompt_color_reset_foreground}|${prompt_color_bright_green}${project_name^^}${prompt_color_reset_foreground}[${prompt_color_bright_green}${environment_name}${prompt_color_reset_foreground}]:${prompt_color_light_blue}\\w${prompt_color_reset_all}\\$ "
