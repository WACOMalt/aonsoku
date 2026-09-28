import { useTranslation } from 'react-i18next'
import {
  Content,
  ContentItem,
  ContentItemForm,
  ContentItemTitle,
  Header,
  HeaderDescription,
  HeaderTitle,
  Root,
} from '@/app/components/settings/section'
import { Switch } from '@/app/components/ui/switch'
import { useGaplessSettings } from '@/store/player.store'

export function GaplessConfig() {
  const { t } = useTranslation()
  const { enabled, setEnabled } = useGaplessSettings()

  return (
    <Root>
      <Header>
        <HeaderTitle>{t('settings.audio.gapless.group')}</HeaderTitle>
        <HeaderDescription>
          {t('settings.audio.gapless.description')}
        </HeaderDescription>
      </Header>

      <Content>
        <ContentItem>
          <ContentItemTitle>
            {t('settings.audio.gapless.enabled')}
          </ContentItemTitle>
          <ContentItemForm>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </ContentItemForm>
        </ContentItem>
      </Content>
    </Root>
  )
}
